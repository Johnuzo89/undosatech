# The UndosaTech Moat Stack

Four interlocking systems that make the platform hard to replicate. Each is
useful alone; together they reference each other through the same hash-chained
audit log, so copying one module gives a competitor none of the accumulated
trust, history, or network position.

| Layer | Module | What compounds over time |
|---|---|---|
| Verifiable Research Certificates | `orchestrator/certificates.py` | Append-only certificate chain — history cannot be manufactured retroactively |
| Governance Evidence Packs | `orchestrator/evidence_packs.py` | Library of regulator-accepted packs across jurisdictions |
| Reactivation Index | `orchestrator/archive_index.py` | Cross-institution archive catalogue — grows with every node |
| Epsilon Ledger | `orchestrator/epsilon_ledger.py` | Lifetime privacy-budget accounting per dataset |

## 1. Governance Evidence Packs (international)

`POST /evidence/pack {study_id, jurisdiction}` assembles regulator-ready
governance evidence from **live platform state** — audit chain, lineage, SDC
config, epsilon ledger, certificates — never from hand-written claims.

Supported frameworks (`GET /evidence/frameworks`):

- **UK** — Five Safes, NHS DSPT, DARS-style controls
- **EU** — GDPR Articles 5 / 25 / 30 / 32 / 89, EHDS secondary-use readiness
- **US** — HIPAA §164.514 de-identification (expert-determination support),
  §164.312 technical safeguards, Common Rule 45 CFR 46 IRB criteria

Controls are honest: `verified` (platform proves it at generation time),
`attested` (true by architecture), `manual` (institution must supply — ethics
ref, IRB determination, BAA). Every pack is itself certified with a
Verifiable Research Certificate, so a reviewer can prove it was
machine-generated and never edited.

## 2. Reactivation Index (auto-detect, auto-deploy)

A federated catalogue of archived imaging holdings across institutions —
**no image, filename, or path ever leaves the archive**.

Fully automatic pipeline:

1. A node heartbeats. If it is a **real institutional node** (institutional
   domain, non-local host, approved) and has no fresh profile, the
   orchestrator auto-assigns a `profile_archive` task. No human in the loop.
2. The node client picks the task up on its normal 60s poll, scans
   `ARCHIVE_PATH` locally (counts by modality, year range from mtimes, total
   volume), and submits aggregates only. Opt out with `ARCHIVE_PROFILE=off`.
3. The orchestrator suppresses small counts (SDC k-threshold), infers the
   **jurisdiction from the institution's domain** (UK / US / EU / CA / AU /
   AFRICA / OTHER), and stores the profile.

Endpoints: `GET /index?jurisdiction=US&modality=DICOM` (researchers, auth),
`GET /index/summary` (public, SDC-safe, rounded — the shop window),
`GET /nodes/{id}/tasks` + `POST /index/profile` (node-authenticated).

Node env additions: `ARCHIVE_PATH` (default `/data`), `ARCHIVE_PROFILE`
(`auto`|`off`), `ARCHIVE_LABEL` (display label, never a real path).

## 3. Epsilon Ledger

Per-dataset differential-privacy budget, accounted across **all studies and
all time** using sequential composition (the conservative upper bound), and
**enforced**: when a dataset's cumulative ε reaches `DATASET_EPSILON_BUDGET`
(default 10.0), further DP releases against it return 403. Charges are only
recorded when a result is actually released, and every charge lands on the
audit chain.

Endpoints: `GET /dp/ledger` (all datasets), `GET /dp/ledger/{dataset_key}`
(full charge history). Charged automatically by `/dp/query` and
`/synthetic/generate` (when `dp_epsilon` set).

## 4. Foundation fine-tuning + automatic model certification

Studies accept `finetune_mode=head_only`: the pretrained backbone is frozen
and federated rounds train only the classifier head — institutions with small
archives can still fine-tune a large model. Lineage records a
`finetuned_from_foundation` edge (model → `imagenet1k/<arch>`).

**Every completed federated model is auto-issued a Verifiable Research
Certificate** binding it to its training provenance — the artifact MHRA/FDA
AI-provenance expectations ask for.

## Supabase migrations

```sql
create table if not exists epsilon_ledger (
  id bigint generated always as identity primary key,
  dataset_key text not null,
  epsilon double precision not null,
  delta double precision,
  cumulative double precision,
  budget double precision,
  actor text, context jsonb,
  charged_at timestamptz default now()
);

create table if not exists evidence_packs (
  id bigint generated always as identity primary key,
  pack_id text unique not null,
  study_id text not null,
  jurisdiction text not null,
  pack jsonb not null,
  created_at timestamptz default now()
);

create table if not exists archive_profiles (
  id bigint generated always as identity primary key,
  node_id text not null,
  profile jsonb not null,
  created_at timestamptz default now()
);

alter table epsilon_ledger   enable row level security;
alter table evidence_packs   enable row level security;
alter table archive_profiles enable row level security;
```

## Business model mapping

- **Evidence packs** — sold per study or bundled into researcher
  subscriptions; the pack is what unblocks the IG office that would otherwise
  say no.
- **Reactivation Index** — the dataset activation fee's engine: pharma asks
  "who holds X", the index answers, activation revenue follows.
- **Epsilon ledger** — the data controller's reason to route ALL access
  through UndosaTech (the guarantee only holds if nothing goes around it) —
  switching costs.
- **Model certification** — the Series A story: governed federated
  fine-tuning with cryptographic training provenance.
