# Verifiable Research Certificates (VRC)

Every governed output produced on UndosaTech — a trained federated model, a
differentially-private query result, a synthetic export, an analytics result —
can be issued a **Verifiable Research Certificate**: a portable, signed,
machine-readable proof that the output was produced under governed conditions.

A certificate binds together, at the moment of issuance:

| Field | What it proves |
|---|---|
| `subject` | Which artefact this certifies |
| `provenance` | The full lineage chain (dataset → study → model/output) |
| `governance.sdc_min_cell_count` | The small-number suppression threshold in force |
| `governance.audit_anchor` | The tip of the hash-chained audit log — pins the cert to a tamper-evident history |
| `governance.audit_chain_valid` / `audit_entries_verified` | Audit chain integrity at issuance |
| `prev_cert_hash` | Chains certificates transparency-log style — the registry is append-only |
| `signature` | Ed25519 signature over the canonical payload |

## Why this matters

A journal reviewer, REC, funder, information governance office, or regulator
does not need to trust UndosaTech (or take a screenshot of a dashboard as
evidence). They verify the certificate themselves:

- **Online:** `GET https://undosatech-production.up.railway.app/certificates/{cert_id}/verify` — no account needed.
- **Offline:** with the certificate JSON and the published public key
  (`GET /certificates/public-key`), verification is ~10 lines of code and
  works even if UndosaTech no longer exists.

Because each certificate embeds the audit-chain tip and the hash of the
previous certificate, history cannot be rewritten retroactively — not by an
attacker, and not by us. The registry only grows, and its integrity is
independently checkable at every point.

## Offline verification (no UndosaTech dependency)

```python
import json, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

cert = json.load(open("certificate.json"))        # from GET /certificates/{id}
pubkey_hex = "..."                                 # from GET /certificates/public-key

payload = json.dumps(cert["payload"], sort_keys=True,
                     separators=(",", ":"), default=str).encode()
Ed25519PublicKey.from_public_bytes(bytes.fromhex(pubkey_hex)) \
    .verify(bytes.fromhex(cert["signature"]), payload)        # raises if forged
print("Certificate", cert["payload"]["cert_id"], "is authentic ✓")
```

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /certificates/issue` | Bearer token | Issue a certificate for `{entity_type, entity_id}` |
| `GET /certificates/{cert_id}` | Public | Fetch a certificate (metadata + hashes only, no data) |
| `GET /certificates/{cert_id}/verify` | Public | Full server-side verification verdict |
| `GET /certificates/public-key` | Public | Ed25519 public key (hex + PEM) for offline verification |

Certifiable entity types: `study`, `model`, `synthetic_export`,
`query_result`, `analytics_result`.

## Key management

Production signs with the `CERT_SIGNING_KEY` Railway secret (64 hex chars =
32-byte Ed25519 seed). Generate one with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Rotating the key invalidates server-side verification of older certificates
unless the old public key remains published; treat it like a CA key. Locally,
a dev key is auto-generated at `.cert_signing_key` (gitignored).

## Supabase table

```sql
create table if not exists trust_certificates (
  id           bigint generated always as identity primary key,
  cert_id      text unique not null,
  entity_type  text not null,
  entity_id    text not null,
  certificate  jsonb not null,
  created_at   timestamptz default now()
);
alter table trust_certificates enable row level security;
```

(No policies needed — only the service role writes/reads it.)
