-- ============================================================
-- UndosaTech: FL Node Registry
-- Run this in your Supabase SQL editor
-- ============================================================

-- Registered federated learning nodes
CREATE TABLE IF NOT EXISTS fl_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    node_id TEXT UNIQUE NOT NULL,           -- e.g. "nhs-moorfields-001"
    institution_name TEXT NOT NULL,          -- e.g. "NHS Moorfields Eye Hospital"
    institution_domain TEXT,                 -- e.g. "moorfields.nhs.uk"
    contact_email TEXT NOT NULL,
    
    -- Network
    host TEXT NOT NULL,                      -- IP or hostname the orchestrator can reach
    port INTEGER NOT NULL DEFAULT 8080,
    
    -- Auth
    api_key_hash TEXT NOT NULL,             -- SHA-256 of the node's API key (never store plaintext)
    
    -- Metadata
    gpu_available BOOLEAN DEFAULT FALSE,
    max_samples INTEGER,                     -- Max training samples this node will contribute
    supported_models TEXT[] DEFAULT ARRAY[]::TEXT[],
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],     -- e.g. ["ophthalmology", "radiology"]
    
    -- Status
    status TEXT NOT NULL DEFAULT 'pending'   -- pending | active | offline | suspended
        CHECK (status IN ('pending', 'active', 'offline', 'suspended')),
    last_heartbeat TIMESTAMPTZ,
    last_seen_ip TEXT,
    
    -- Approval
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    -- Timestamps
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Heartbeat / status log (lightweight — keep 7 days)
CREATE TABLE IF NOT EXISTS fl_node_heartbeats (
    id BIGSERIAL PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES fl_nodes(node_id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    latency_ms INTEGER,
    training_active BOOLEAN DEFAULT FALSE,
    current_study_id TEXT
);

-- Auto-clean heartbeats older than 7 days
CREATE OR REPLACE FUNCTION delete_old_heartbeats() RETURNS trigger AS $$
BEGIN
    DELETE FROM fl_node_heartbeats
    WHERE recorded_at < NOW() - INTERVAL '7 days';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER cleanup_heartbeats
    AFTER INSERT ON fl_node_heartbeats
    FOR EACH ROW EXECUTE FUNCTION delete_old_heartbeats();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER fl_nodes_updated_at
    BEFORE UPDATE ON fl_nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_fl_nodes_status ON fl_nodes(status);
CREATE INDEX IF NOT EXISTS idx_fl_nodes_node_id ON fl_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_node_id ON fl_node_heartbeats(node_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_recorded_at ON fl_node_heartbeats(recorded_at);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE fl_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fl_node_heartbeats ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read active/approved nodes
CREATE POLICY "authenticated_read_active_nodes"
    ON fl_nodes FOR SELECT
    TO authenticated
    USING (status IN ('active', 'offline'));

-- Service role can do everything (used by FastAPI backend)
CREATE POLICY "service_role_full_access_nodes"
    ON fl_nodes FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_heartbeats"
    ON fl_node_heartbeats FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- Seed: pre-approve the two simulated nodes
-- ============================================================

-- NOTE: Replace 'HASHED_KEY_HERE' with: SELECT encode(sha256('your-secret-key'::bytea), 'hex');
-- The actual API keys are set in your Railway env vars as NODE_API_KEY_MOORFIELDS etc.

INSERT INTO fl_nodes (
    node_id, institution_name, institution_domain, contact_email,
    host, port, api_key_hash,
    gpu_available, max_samples, supported_models, tags,
    status, approved_at
) VALUES 
(
    'nhs-moorfields-sim',
    'NHS Moorfields Eye Hospital (Simulated)',
    'moorfields.nhs.uk',
    'research@moorfields.nhs.uk',
    'localhost', 8081,
    encode(sha256('moorfields-sim-key-change-me'::bytea), 'hex'),
    false, 5000,
    ARRAY['ResNet-18', 'EfficientNet-B0', 'Lightweight CNN'],
    ARRAY['ophthalmology', 'retinal'],
    'active', NOW()
),
(
    'uni-edinburgh-sim',
    'University of Edinburgh (Simulated)',
    'ed.ac.uk',
    'research@ed.ac.uk',
    'localhost', 8082,
    encode(sha256('edinburgh-sim-key-change-me'::bytea), 'hex'),
    false, 5000,
    ARRAY['ResNet-18', 'ResNet-50', 'ViT-B/16', 'EfficientNet-B4'],
    ARRAY['general', 'pathology'],
    'active', NOW()
)
ON CONFLICT (node_id) DO NOTHING;

-- ============================================================
-- Useful views
-- ============================================================

CREATE OR REPLACE VIEW fl_nodes_summary AS
SELECT
    n.node_id,
    n.institution_name,
    n.institution_domain,
    n.status,
    n.gpu_available,
    n.max_samples,
    n.supported_models,
    n.tags,
    n.last_heartbeat,
    CASE 
        WHEN n.last_heartbeat > NOW() - INTERVAL '2 minutes' THEN 'online'
        WHEN n.last_heartbeat > NOW() - INTERVAL '10 minutes' THEN 'degraded'
        ELSE 'unreachable'
    END AS connectivity,
    n.registered_at,
    n.approved_at
FROM fl_nodes n
WHERE n.status NOT IN ('pending', 'suspended');

COMMENT ON TABLE fl_nodes IS 'Registered federated learning nodes. Nodes self-register via POST /nodes/register and are approved by admins.';
COMMENT ON TABLE fl_node_heartbeats IS 'Heartbeat log for registered FL nodes. Auto-cleaned after 7 days.';
