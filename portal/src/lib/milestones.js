// Platform milestones — the shipped-capability record surfaced in the Trust
// Center so researchers, RECs, and partners can see what the platform actually
// does today (and when it landed) rather than inferring it from the UI.
//
// Newest first. Keep entries factual and capability-level; each maps to
// something a visitor can exercise in the portal or verify independently.

export const PLATFORM_VERSION = '1.4'

export const MILESTONES = [
  {
    date: '2026-07',
    title: 'Durable audit chain across redeploys',
    tag: 'Integrity',
    body: 'The hash-chained audit log now recovers its tip from the durable store on restart, so provenance and certificate anchoring survive a redeploy instead of re-anchoring. Verification reports the full history, not just this deployment’s segment.',
  },
  {
    date: '2026-07',
    title: 'Portal information architecture',
    tag: 'Product',
    body: 'Grouped navigation (Data, Analyse, TRE, Studies, Nodes, Governance, Admin) with an MFA-gated admin area. Trust Center consolidates certificates, evidence packs, the privacy ledger, and the reactivation index.',
  },
  {
    date: '2026-07',
    title: 'Moat stack — evidence packs, reactivation index, ε-ledger',
    tag: 'Governance',
    body: 'Regulator-ready evidence packs for UK, EU, and US frameworks generated from live evidence; a federated Reactivation Index that auto-profiles institutional archives; and a per-dataset differential-privacy budget enforced on release.',
  },
  {
    date: '2026-07',
    title: 'Verifiable Research Certificates',
    tag: 'Integrity',
    body: 'Ed25519-signed, append-only certificates bind each output to its lineage, disclosure-control settings, and the audit-chain tip. Anyone can verify them offline with the published public key — no account required.',
  },
  {
    date: '2026-07',
    title: 'Federated node deployment',
    tag: 'Infrastructure',
    body: 'Outbound-only Flower client nodes with a signed container image and CycloneDX SBOM attestation. Institutions run compute locally; only governed aggregates leave the building.',
  },
  {
    date: '2026-07',
    title: 'Disclosure control & analytics',
    tag: 'Governance',
    body: 'Statistical disclosure control (small-cell suppression) across every output path, a DuckDB SQL console in a locked sandbox, and differential-privacy queries with per-query audit.',
  },
  {
    date: '2026-07',
    title: 'Interoperability — OMOP CDM & FHIR R4',
    tag: 'Standards',
    body: 'OMOP CDM v5.4 schema with the medical-imaging extension, plus a FHIR R4 Bundle adapter that maps ingested records into the common data model.',
  },
  {
    date: '2026-07',
    title: 'Provenance & tenant isolation',
    tag: 'Foundations',
    body: 'Lineage graph tracing dataset → study → model → output, institution-scoped row-level security, TOTP multi-factor authentication, and in-app observability.',
  },
]
