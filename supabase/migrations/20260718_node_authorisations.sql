-- Institutional authorisation layer for node activation.
-- A node can no longer be activated on the strength of an institutional email
-- domain alone: a named authoriser (PI, data custodian, or IT security) at the
-- institution must confirm via an emailed token, and only then can a platform
-- admin approve the node.
--
-- Run in the Supabase SQL editor (service role). Idempotent.

create table if not exists node_authorisations (
  id               bigint generated always as identity primary key,
  node_id          text not null,
  authoriser_name  text not null,
  authoriser_role  text not null check (authoriser_role in ('pi', 'data_custodian', 'it_security')),
  authoriser_email text not null,
  token_hash       text not null,
  requested_at     timestamptz not null default now(),
  confirmed_at     timestamptz,
  declined_at      timestamptz,
  decline_reason   text
);

create index if not exists idx_node_authorisations_node on node_authorisations (node_id);
create index if not exists idx_node_authorisations_token on node_authorisations (token_hash);

-- Service role only: no anon/authenticated policies, RLS denies by default.
alter table node_authorisations enable row level security;
