-- supabase_schema.sql
-- Run this in your Supabase SQL editor:
-- https://supabase.com/dashboard/project/hpfuacpmocnsxdgbnidm/sql/new
-- ─────────────────────────────────────────────────────────────────────────────

-- ── fl_nodes ──────────────────────────────────────────────────────────────────
-- Referenced by api.py: supabase_admin.table("fl_nodes")
-- Stores registered on-premise FL nodes.

CREATE TABLE IF NOT EXISTS fl_nodes (
    node_id             TEXT PRIMARY KEY,
    institution_name    TEXT NOT NULL,
    institution_domain  TEXT NOT NULL,
    contact_email       TEXT NOT NULL,
    host                TEXT NOT NULL,
    port                INTEGER NOT NULL DEFAULT 8080,
    api_key_hash        TEXT NOT NULL,           -- SHA-256 of the api_key (never store raw)
    gpu_available       BOOLEAN NOT NULL DEFAULT FALSE,
    max_samples         INTEGER,
    supported_models    TEXT[] DEFAULT '{}',
    tags                TEXT[] DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('active', 'offline', 'pending', 'suspended')),
    last_heartbeat      TIMESTAMPTZ,
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at         TIMESTAMPTZ
);

-- Index for status-based lookups (used in list_nodes and _mark_stale_nodes_offline)
CREATE INDEX IF NOT EXISTS idx_fl_nodes_status ON fl_nodes (status);
CREATE INDEX IF NOT EXISTS idx_fl_nodes_last_heartbeat ON fl_nodes (last_heartbeat);


-- ── fl_node_heartbeats ────────────────────────────────────────────────────────
-- Referenced by api.py: supabase_admin.table("fl_node_heartbeats")
-- Append-only heartbeat log for debugging and monitoring.

CREATE TABLE IF NOT EXISTS fl_node_heartbeats (
    id                  BIGSERIAL PRIMARY KEY,
    node_id             TEXT NOT NULL REFERENCES fl_nodes(node_id) ON DELETE CASCADE,
    latency_ms          INTEGER,
    training_active     BOOLEAN DEFAULT FALSE,
    current_study_id    TEXT,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for per-node lookups
CREATE INDEX IF NOT EXISTS idx_heartbeats_node_id ON fl_node_heartbeats (node_id);
-- Prune rows older than 7 days (optional — run as a scheduled Supabase cron job)
-- DELETE FROM fl_node_heartbeats WHERE recorded_at < NOW() - INTERVAL '7 days';


-- ── Row-level security ────────────────────────────────────────────────────────
-- The orchestrator uses the SERVICE KEY (bypasses RLS).
-- The frontend uses the ANON KEY — restrict reads to active/pending nodes only.

ALTER TABLE fl_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fl_node_heartbeats ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read non-suspended nodes
CREATE POLICY "Authenticated users can read nodes"
  ON fl_nodes FOR SELECT
  TO authenticated
  USING (status != 'suspended');

-- Service role (backend) has full access — no policy needed (it bypasses RLS)

-- No direct frontend writes to fl_nodes (all writes go through the backend API)


-- ── Model storage migration ───────────────────────────────────────────────────
-- Run this once to add the storage key column and create the Storage bucket.
-- The bucket must be created in Supabase Dashboard → Storage → New bucket
--   Name: models  |  Public: OFF
-- Or the backend will create it automatically on first startup.

ALTER TABLE studies ADD COLUMN IF NOT EXISTS model_storage_key TEXT;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS per_class_metrics JSONB;
-- per_class_metrics shape: {"ClassName": {"recall": 0.91, "precision": 0.88, "f1": 0.895, "support": 120}, ...}


-- ── access_requests ──────────────────────────────────────────────────────────
-- Non-institutional users apply for access; admin reviews here.
-- Frontend inserts via anon key; reads/updates go through the service key (backend).

CREATE TABLE IF NOT EXISTS access_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             TEXT NOT NULL,
    full_name         TEXT NOT NULL,
    institution       TEXT NOT NULL,
    role              TEXT,
    research_area     TEXT,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests (status);
CREATE INDEX IF NOT EXISTS idx_access_requests_email  ON access_requests (email);

-- Anyone can insert a request (anon key)
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit an access request"
  ON access_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only the service role (backend) can read or update
-- No frontend SELECT policy — reads go through /admin/* API endpoints


-- ── study_invitations ────────────────────────────────────────────────────────
-- Researcher A invites Institution B's node to participate in a study.
-- Training still starts immediately; invitations are a governance/consent record.
-- Responded to by admin (or node operator via API key).

CREATE TABLE IF NOT EXISTS study_invitations (
    id                BIGSERIAL PRIMARY KEY,
    study_id          TEXT NOT NULL,
    node_id           TEXT NOT NULL,
    invited_by        TEXT NOT NULL,          -- user_id of researcher
    invited_by_email  TEXT,
    study_name        TEXT,
    message           TEXT,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
    responded_at      TIMESTAMPTZ,
    decline_reason    TEXT,
    invited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(study_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_study_invitations_study  ON study_invitations(study_id);
CREATE INDEX IF NOT EXISTS idx_study_invitations_node   ON study_invitations(node_id);
CREATE INDEX IF NOT EXISTS idx_study_invitations_status ON study_invitations(status);

ALTER TABLE study_invitations ENABLE ROW LEVEL SECURITY;
-- All reads/writes via service key (backend) — no frontend direct access

-- ── Verify ────────────────────────────────────────────────────────────────────
-- After running the above, confirm:
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('fl_nodes', 'fl_node_heartbeats');
-- Should return 2 rows.
