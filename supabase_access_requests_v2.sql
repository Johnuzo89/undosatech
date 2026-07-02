-- supabase_access_requests_v2.sql
-- Adds cohort tracking + self-read RLS to access_requests
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/hpfuacpmocnsxdgbnidm/sql/new

-- Track which cohort was applied for
ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS cohort_id   UUID REFERENCES cohorts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cohort_name TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Index for fast per-user lookups (used by the researcher portal)
CREATE INDEX IF NOT EXISTS idx_access_requests_email_status
  ON access_requests (email, status);

-- Allow authenticated users to read their own requests
-- (Previously only service role could SELECT — now researchers can track their own apps)
CREATE POLICY IF NOT EXISTS "Users can read own access requests"
  ON access_requests FOR SELECT
  TO authenticated
  USING (email = (auth.jwt()->>'email'));

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'access_requests'
ORDER BY ordinal_position;
