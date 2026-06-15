-- UndosaTech: Analytics & Extended Columns Migration
-- Run this in Supabase SQL Editor if studies are failing mid-training.
-- All statements use ADD COLUMN IF NOT EXISTS so it is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Research / per-round metrics ─────────────────────────────────────────────
ALTER TABLE studies ADD COLUMN IF NOT EXISTS macro_f1            NUMERIC;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS weighted_f1         NUMERIC;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS cohen_kappa         NUMERIC;

-- ── Differential privacy accounting ──────────────────────────────────────────
ALTER TABLE studies ADD COLUMN IF NOT EXISTS dp_epsilon_spent    NUMERIC;

-- ── Convergence diagnostics ───────────────────────────────────────────────────
ALTER TABLE studies ADD COLUMN IF NOT EXISTS training_health     JSONB;

-- ── Bootstrap confidence intervals ───────────────────────────────────────────
ALTER TABLE studies ADD COLUMN IF NOT EXISTS confidence_intervals JSONB;

-- ── Model interpretability ────────────────────────────────────────────────────
ALTER TABLE studies ADD COLUMN IF NOT EXISTS interpretability    JSONB;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS class_names         JSONB;

-- ── Data provenance ───────────────────────────────────────────────────────────
ALTER TABLE studies ADD COLUMN IF NOT EXISTS data_description    TEXT;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS live_status         TEXT;

-- ── Queue management ─────────────────────────────────────────────────────────
ALTER TABLE studies ADD COLUMN IF NOT EXISTS queue_position      INTEGER;

-- ── Architecture alias (api.py sometimes writes "architecture" not "model") ──
ALTER TABLE studies ADD COLUMN IF NOT EXISTS architecture        TEXT;

-- Backfill architecture from model for existing rows
UPDATE studies SET architecture = model WHERE architecture IS NULL AND model IS NOT NULL;
