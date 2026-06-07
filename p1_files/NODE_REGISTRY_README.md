# UndosaTech — Node Registration Portal

## What Was Built

### Architecture

```
Institution Server                   Railway (Orchestrator)        Supabase
┌──────────────────────┐             ┌────────────────────────┐    ┌──────────────┐
│  Docker Container    │             │  FastAPI api.py         │    │  fl_nodes    │
│  ┌────────────────┐  │  register   │  POST /nodes/register  │───▶│  table       │
│  │register_and_   │──┼────────────▶│  POST /nodes/heartbeat │    │              │
│  │run.sh          │  │  heartbeat  │  GET  /nodes/list      │◀───│  fl_node_    │
│  └────────────────┘  │  (60s)      │  POST /nodes/{id}/     │    │  heartbeats  │
│  ┌────────────────┐  │             │       deregister       │    └──────────────┘
│  │fl_nodes/       │  │◀────────────│                        │
│  │client.py       │  │  training   └────────────────────────┘
│  └────────────────┘  │  commands
└──────────────────────┘

Portal (React/Vercel)
┌──────────────────────────────┐
│  NodeRegistry.jsx tab        │
│  • Live node list (15s poll) │
│  • Click to select for study │
│  • Register new node modal   │
└──────────────────────────────┘
```

---

## Deployment Checklist

### 1. Supabase (do this first)

1. Open https://supabase.com/dashboard → your project → **SQL Editor**
2. Paste and run `supabase_migration_nodes.sql`
3. Verify: **Table Editor** → you should see `fl_nodes` and `fl_node_heartbeats`
4. Get your **Service Role key**: Settings → API → `service_role` (secret) key

### 2. Railway (backend)

Add these environment variables in Railway dashboard:

```
SUPABASE_URL=https://hpfuacpmocnsxdgbnidm.supabase.co
SUPABASE_SERVICE_KEY=<your service_role key>
NODE_REGISTRATION_SECRET=<generate with: python3 -c "import secrets; print(secrets.token_urlsafe(32))">
```

Add `supabase` to `requirements.txt`:
```
supabase>=2.0.0
```

In `orchestrator/api.py`:
1. Add the imports from `api_nodes_addition.py` to the top
2. Paste all the endpoint functions after your existing endpoints
3. Add `_node_monitor_loop()` call in your startup code (after `supabase_admin` is defined)

### 3. React Portal

```bash
# Copy component
cp portal/src/components/NodeRegistry.jsx ~/undosatech/portal/src/components/

# Apply integration changes from App.jsx.patch.md
# Then deploy:
cd ~/undosatech/portal
git add .
git commit -m "feat: node registry portal tab"
git push  # Vercel auto-deploys
```

### 4. Docker Node (for real institutions)

```bash
# Build
docker build -f Dockerfile.node -t undosatech-node .

# Push to Docker Hub (institutions pull from here)
docker tag undosatech-node undosatech/fl-node:latest
docker push undosatech/fl-node:latest
```

For institutions to deploy:
1. Send them `docker-compose.node.yml` and `.env.node.example`
2. Send them the `NODE_REGISTRATION_SECRET` (keep this private)
3. They fill in their `.env.node` and run:
   ```bash
   docker compose -f docker-compose.node.yml --env-file .env.node up -d
   ```
4. Node auto-registers → appears in portal

---

## API Reference

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/nodes/register` | POST | Registration Secret | One-time node registration |
| `/nodes/heartbeat` | POST | Node API Key | Node liveness ping (60s) |
| `/nodes/list` | GET | Supabase JWT | List all nodes (portal) |
| `/nodes/{id}/status` | GET | Supabase JWT | Single node status |
| `/nodes/{id}/deregister` | POST | Node API Key | Take node offline |

---

## Security Notes

- **API keys are hashed** (SHA-256) before storage — even if the DB is compromised, keys can't be replayed
- **Registration secret** gates who can add nodes — don't put it in frontend code
- **NHS/ac.uk domains** are auto-approved; others need admin sign-off
- **Node keys are returned once** — if lost, node must re-register with a new `node_id`
- **RLS policies** ensure authenticated portal users can only read active nodes (not pending/suspended)
- The service role key is **backend-only** — never put it in the React portal

---

## Testing Locally

```bash
# Test registration
curl -X POST http://localhost:8000/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "test-node-001",
    "institution_name": "Test University",
    "institution_domain": "test.ac.uk",
    "contact_email": "test@test.ac.uk",
    "host": "localhost",
    "port": 8080,
    "registration_secret": "YOUR_SECRET_HERE",
    "supported_models": ["ResNet-18"],
    "tags": ["general"]
  }'

# Test heartbeat (use api_key from registration response)
curl -X POST http://localhost:8000/nodes/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "test-node-001",
    "api_key": "RETURNED_API_KEY",
    "training_active": false
  }'

# List nodes (use Supabase JWT)
curl http://localhost:8000/nodes/list \
  -H "Authorization: Bearer SUPABASE_JWT"
```

---

## What's Next

See the main README for priorities 2–5:
- **Priority 2**: Differential privacy (Gaussian noise on gradients)
- **Priority 3**: Study invitation system
- **Priority 4**: Persistent study storage (Supabase)
- **Priority 5**: Admin dashboard
