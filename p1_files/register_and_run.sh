#!/usr/bin/env bash
# ============================================================
# register_and_run.sh
# Entrypoint for the UndosaTech FL Node container.
# 1. Registers with the orchestrator (once, idempotent via KEY_FILE)
# 2. Starts the Flower FL client
# 3. Sends heartbeats every 60s in the background
# ============================================================

set -euo pipefail

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-https://undosatech-production.up.railway.app}"
KEY_FILE="${KEY_FILE:-/secrets/node_api_key.txt}"
NODE_PORT="${NODE_PORT:-8080}"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[undosatech-node]${NC} $1"; }
ok()   { echo -e "${GREEN}[undosatech-node]${NC} $1"; }
warn() { echo -e "${YELLOW}[undosatech-node]${NC} $1"; }
die()  { echo -e "${RED}[undosatech-node] ERROR:${NC} $1"; exit 1; }

# ── Validate required env vars ───────────────────────────────────────────────
for var in NODE_ID INSTITUTION_NAME INSTITUTION_DOMAIN CONTACT_EMAIL NODE_PUBLIC_HOST REGISTRATION_SECRET; do
    [ -z "${!var:-}" ] && die "Required env var $var is not set. Check your .env.node file."
done

log "Starting UndosaTech FL Node: ${NODE_ID}"
log "Institution: ${INSTITUTION_NAME} (${INSTITUTION_DOMAIN})"
log "Orchestrator: ${ORCHESTRATOR_URL}"

# ── Step 1: Register (skip if API key already saved) ─────────────────────────
if [ -f "$KEY_FILE" ]; then
    API_KEY=$(cat "$KEY_FILE")
    ok "Using existing API key from ${KEY_FILE}"
else
    log "No API key found — registering with orchestrator..."

    MODELS_JSON=$(python3 -c "
import json, os
raw = os.environ.get('SUPPORTED_MODELS', 'ResNet-18')
print(json.dumps([m.strip() for m in raw.split(',')]))
")

    TAGS_JSON=$(python3 -c "
import json, os
raw = os.environ.get('TAGS', 'general')
print(json.dumps([t.strip() for t in raw.split(',')]))
")

    PAYLOAD=$(python3 -c "
import json, os
print(json.dumps({
    'node_id': os.environ['NODE_ID'],
    'institution_name': os.environ['INSTITUTION_NAME'],
    'institution_domain': os.environ['INSTITUTION_DOMAIN'],
    'contact_email': os.environ['CONTACT_EMAIL'],
    'host': os.environ['NODE_PUBLIC_HOST'],
    'port': int(os.environ.get('NODE_PORT', 8080)),
    'gpu_available': os.environ.get('GPU_AVAILABLE', 'false').lower() == 'true',
    'max_samples': int(os.environ['MAX_SAMPLES']) if os.environ.get('MAX_SAMPLES') else None,
    'supported_models': ${MODELS_JSON},
    'tags': ${TAGS_JSON},
    'registration_secret': os.environ['REGISTRATION_SECRET'],
}))
")

    RESPONSE=$(curl -sf \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        "${ORCHESTRATOR_URL}/nodes/register" \
        --connect-timeout 10 \
        --max-time 30
    ) || die "Registration request to ${ORCHESTRATOR_URL}/nodes/register failed. Is the orchestrator running?"

    STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
    API_KEY=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('api_key',''))")
    MESSAGE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))")

    [ -z "$API_KEY" ] && die "Registration succeeded but no api_key in response: $RESPONSE"

    mkdir -p "$(dirname "$KEY_FILE")"
    echo "$API_KEY" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"

    ok "Registered! Status: ${STATUS}"
    ok "${MESSAGE}"
fi

# ── Step 2: Heartbeat loop (background) ──────────────────────────────────────
heartbeat_loop() {
    log "Starting heartbeat loop (every 60s)..."
    while true; do
        sleep 60
        PAYLOAD=$(python3 -c "
import json, os
print(json.dumps({
    'node_id': os.environ['NODE_ID'],
    'api_key': open(os.environ.get('KEY_FILE', '/secrets/node_api_key.txt')).read().strip(),
    'training_active': False,
}))
")
        curl -sf \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD" \
            "${ORCHESTRATOR_URL}/nodes/heartbeat" \
            --connect-timeout 5 \
            --max-time 10 \
            > /dev/null 2>&1 || warn "Heartbeat failed (will retry in 60s)"
    done
}
heartbeat_loop &
HEARTBEAT_PID=$!

# ── Step 3: Simple local health endpoint ─────────────────────────────────────
# Quick Python HTTP server for Docker HEALTHCHECK
python3 -c "
import http.server, threading, os, json

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            'status': 'ok',
            'node_id': os.environ.get('NODE_ID'),
            'institution': os.environ.get('INSTITUTION_NAME'),
        }).encode())
    def log_message(self, *a): pass  # suppress access logs

port = int(os.environ.get('NODE_PORT', 8080))
srv = http.server.HTTPServer(('0.0.0.0', port), H)
t = threading.Thread(target=srv.serve_forever, daemon=True)
t.start()
print(f'Health endpoint on :{port}/health')
" &
HEALTH_PID=$!

# ── Step 4: Start the Flower FL client ───────────────────────────────────────
ok "Starting Flower FL client..."
python3 fl_nodes/client.py \
    --node-id "${NODE_ID}" \
    --api-key "$(cat $KEY_FILE)" \
    --orchestrator-url "${ORCHESTRATOR_URL}" \
    --data-path "${DATA_PATH:-/data}" &
FL_PID=$!

# ── Trap shutdown ─────────────────────────────────────────────────────────────
cleanup() {
    warn "Shutting down..."
    kill $HEARTBEAT_PID $HEALTH_PID $FL_PID 2>/dev/null || true

    # Tell orchestrator we're going offline
    PAYLOAD=$(python3 -c "
import json, os
print(json.dumps({
    'api_key': open(os.environ.get('KEY_FILE', '/secrets/node_api_key.txt')).read().strip()
}))
")
    curl -sf \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        "${ORCHESTRATOR_URL}/nodes/${NODE_ID}/deregister" \
        --connect-timeout 5 \
        --max-time 10 \
        > /dev/null 2>&1 || true

    ok "Goodbye from ${NODE_ID}"
}
trap cleanup SIGTERM SIGINT

wait $FL_PID
