-- Moat stack tables: Verifiable Research Certificates, epsilon ledger,
-- evidence packs, archive profiles. All service-role only (RLS on, no
-- policies) — the orchestrator mirrors its JSONL stores here.

create table if not exists trust_certificates (
  id           bigint generated always as identity primary key,
  cert_id      text unique not null,
  entity_type  text not null,
  entity_id    text not null,
  certificate  jsonb not null,
  created_at   timestamptz default now()
);

create table if not exists epsilon_ledger (
  id          bigint generated always as identity primary key,
  dataset_key text not null,
  epsilon     double precision not null,
  delta       double precision,
  cumulative  double precision,
  budget      double precision,
  actor       text,
  context     jsonb,
  charged_at  timestamptz default now()
);
create index if not exists epsilon_ledger_dataset_idx on epsilon_ledger (dataset_key);

create table if not exists evidence_packs (
  id           bigint generated always as identity primary key,
  pack_id      text unique not null,
  study_id     text not null,
  jurisdiction text not null,
  pack         jsonb not null,
  created_at   timestamptz default now()
);

create table if not exists archive_profiles (
  id         bigint generated always as identity primary key,
  node_id    text not null,
  profile    jsonb not null,
  created_at timestamptz default now()
);
create index if not exists archive_profiles_node_idx on archive_profiles (node_id);

alter table trust_certificates enable row level security;
alter table epsilon_ledger     enable row level security;
alter table evidence_packs     enable row level security;
alter table archive_profiles   enable row level security;
