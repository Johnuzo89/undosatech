-- Study invitations become complete governance packages: research question,
-- investigator, ethics status, requested dataset/variables, model version,
-- privacy settings, expected outputs, retention, and withdrawal process are
-- recorded on the invitation so the institution sees everything before accepting.
--
-- Run in the Supabase SQL editor (service role). Idempotent.

alter table study_invitations add column if not exists governance jsonb;
