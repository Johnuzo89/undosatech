// Demo mode: renders the real portal against canned fixture data, with no
// account and no backend writes. Entered from the auth screen or ?demo=1.
// State lives in this module (mutable, per-tab) so accept/approve actions feel
// real but reset on reload — nothing ever reaches the API or Supabase.

const DEMO_FLAG = 'undosa_demo'
// Components fall back to different API bases when VITE_API_URL is unset
// (App.jsx → localhost, feature panels → Railway), so intercept all of them.
const API_BASES = [
  import.meta.env.VITE_API_URL,
  'https://undosatech-production.up.railway.app',
  'http://localhost:8000',
].filter(Boolean)

export function isDemoMode() {
  try { return sessionStorage.getItem(DEMO_FLAG) === '1' } catch { return false }
}
export function enterDemoMode() {
  try { sessionStorage.setItem(DEMO_FLAG, '1') } catch { /* private mode */ }
  window.location.reload()
}
export function exitDemoMode() {
  try { sessionStorage.removeItem(DEMO_FLAG) } catch { /* private mode */ }
  window.location.href = window.location.pathname
}

export const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@undosatech.com',
  user_metadata: { full_name: 'Demo Reviewer' },
}
export const DEMO_SESSION = { access_token: 'demo-token', user: DEMO_USER }

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = Date.now()
const iso = (daysAgo, h = 0) => new Date(now - daysAgo * 86400e3 - h * 3600e3).toISOString()

export const DEMO_STUDY_ID = 'demo-amd-pilot'
export const DEMO_INVITE_STUDY_ID = 'demo-glaucoma-proposal'

const NODES = [
  {
    node_id: 'moorfields-arc-01', institution_name: 'Moorfields Eye Hospital NHS Foundation Trust',
    institution_domain: 'nhs.net', contact_email: 'data.custodian@moorfields.nhs.uk',
    status: 'active', connectivity: 'online', gpu_available: true,
    supported_models: ['ResNet-18', 'ResNet-50', 'EfficientNet-B0'], max_samples: 12000,
    host: 'outbound-only', port: 443, tags: ['OCT', 'AMD', 'glaucoma'],
    authorisation: { authoriser_name: 'Prof. R. Wilson', authoriser_role: 'data_custodian', requested_at: iso(41), confirmed_at: iso(40) },
    registered_at: iso(41), approved_at: iso(39), last_heartbeat: iso(0, 0.02),
    recent_heartbeats: [
      { id: 'hb1', recorded_at: iso(0, 0.02), training_active: false, latency_ms: 38, current_study_id: null },
      { id: 'hb2', recorded_at: iso(0, 0.5), training_active: false, latency_ms: 41, current_study_id: null },
      { id: 'hb3', recorded_at: iso(0, 1), training_active: true, latency_ms: 44, current_study_id: DEMO_STUDY_ID },
    ],
  },
  {
    node_id: 'edinburgh-srin-02', institution_name: 'University of Edinburgh / NHS Lothian',
    institution_domain: 'ed.ac.uk', contact_email: 'imaging.governance@ed.ac.uk',
    status: 'active', connectivity: 'online', gpu_available: false,
    supported_models: ['ResNet-18', 'EfficientNet-B0'], max_samples: 8000,
    host: 'outbound-only', port: 443, tags: ['fundus', 'OCT-A', 'AMD'],
    authorisation: { authoriser_name: 'Dr M. Fraser', authoriser_role: 'pi', requested_at: iso(35), confirmed_at: iso(35) },
    registered_at: iso(35), approved_at: iso(34), last_heartbeat: iso(0, 0.05),
    recent_heartbeats: [
      { id: 'hb4', recorded_at: iso(0, 0.05), training_active: false, latency_ms: 52, current_study_id: null },
      { id: 'hb5', recorded_at: iso(0, 0.6), training_active: false, latency_ms: 49, current_study_id: null },
    ],
  },
  {
    node_id: 'dundee-visionlab-01', institution_name: 'University of Dundee — Vision Sciences',
    institution_domain: 'dundee.ac.uk', contact_email: 'archives@dundee.ac.uk',
    status: 'pending', connectivity: 'offline', gpu_available: false,
    supported_models: ['ResNet-18'], max_samples: 4500,
    host: 'outbound-only', port: 443, tags: ['OCT', 'keratoconus'],
    authorisation: { authoriser_name: 'Dr E. Souter', authoriser_role: 'it_security', requested_at: iso(2), confirmed_at: iso(1) },
    registered_at: iso(2), approved_at: null, last_heartbeat: null,
    recent_heartbeats: [],
  },
]

// One store serves both perspectives: the researcher's study view and the
// data custodian's node view.
const GOV_AMD = {
  research_question: 'Can archived OCT volumes predict progression from intermediate to advanced AMD within 2 years?',
  investigator: 'j.ohanebo@dundee.ac.uk',
  ethics_status: 'approved', ethics_reference: 'REC-26/ES/0041',
  dataset: 'octmnist',
  requested_variables: 'OCT volumes, AMD stage labels, age band — no identifiers',
  model_version: 'resnet18 · 6 rounds',
  privacy_settings: { dp_enabled: true, dp_epsilon: 3.0, sdc_min_cell_count: 5 },
  expected_outputs: 'Aggregate federated model with per-class metrics; no patient-level outputs',
  retention: 'Model updates retained for the study audit period; no institutional data is copied or retained by the platform.',
  withdrawal: 'The institution may withdraw at any time; its node stops participating from the next round and the withdrawal is recorded on the audit chain.',
}
const GOV_GLAUCOMA = {
  ...GOV_AMD,
  research_question: 'Does combining archived visual fields with OCT improve detection of fast glaucoma progression?',
  ethics_status: 'pending', ethics_reference: 'REC-26/ES/0102 (submitted)',
  requested_variables: 'Visual field indices, OCT RNFL thickness, age band — no identifiers',
  model_version: 'resnet18 · 8 rounds',
}
const INVITATIONS = [
  {
    id: 'demo-inv-1', study_id: DEMO_STUDY_ID, study_name: 'Federated AMD Progression — 3-site pilot',
    node_id: 'moorfields-arc-01', status: 'accepted', responded_at: iso(20),
    invited_by_email: 'j.ohanebo@dundee.ac.uk', invited_at: iso(22),
    message: 'Archived OCT volumes, AMD staging labels only. Full governance package attached.',
    governance: GOV_AMD,
    fl_nodes: { institution_name: 'Moorfields Eye Hospital NHS Foundation Trust', institution_domain: 'nhs.net' },
  },
  {
    id: 'demo-inv-2', study_id: DEMO_STUDY_ID, study_name: 'Federated AMD Progression — 3-site pilot',
    node_id: 'edinburgh-srin-02', status: 'accepted', responded_at: iso(19),
    invited_by_email: 'j.ohanebo@dundee.ac.uk', invited_at: iso(22),
    message: 'Archived OCT volumes, AMD staging labels only. Full governance package attached.',
    governance: GOV_AMD,
    fl_nodes: { institution_name: 'University of Edinburgh / NHS Lothian', institution_domain: 'ed.ac.uk' },
  },
  {
    id: 'demo-inv-3', study_id: DEMO_INVITE_STUDY_ID, study_name: 'Glaucoma progression from archived visual fields',
    node_id: 'moorfields-arc-01', status: 'pending', responded_at: null,
    invited_by_email: 'j.ohanebo@dundee.ac.uk', invited_at: iso(1),
    message: 'Proposal: OCT + visual-field pairs, 2015–2024 archive. Try accepting this one — you will be shown the governance package and Data Use Agreement first.',
    governance: GOV_GLAUCOMA,
    fl_nodes: { institution_name: 'Moorfields Eye Hospital NHS Foundation Trust', institution_domain: 'nhs.net' },
  },
]

const CLASS_NAMES = ['No AMD', 'Early AMD', 'Intermediate AMD', 'Advanced AMD']
const ROUNDS = [0.612, 0.734, 0.801, 0.856, 0.892, 0.914].map((acc, i) => ({
  round: i + 1,
  global_accuracy: acc,
  global_loss: +(1.32 - i * 0.19).toFixed(4),
  macro_f1: +(acc - 0.021).toFixed(3),
  weighted_f1: +(acc - 0.012).toFixed(3),
  cohen_kappa: +(acc - 0.06).toFixed(3),
  per_class_accuracy: [acc + 0.04, acc - 0.03, acc - 0.05, acc + 0.02].map(v => +Math.min(v, 0.99).toFixed(3)),
  node_metrics: [
    { node_id: 'moorfields-arc-01', institution: 'Moorfields Eye Hospital', accuracy: +(acc + 0.011).toFixed(3), loss: +(1.30 - i * 0.19).toFixed(4), num_examples: 4180, learning_rate: 0.001, governance_status: 'consent verified' },
    { node_id: 'edinburgh-srin-02', institution: 'University of Edinburgh / NHS Lothian', accuracy: +(acc - 0.014).toFixed(3), loss: +(1.35 - i * 0.19).toFixed(4), num_examples: 3020, learning_rate: 0.001, governance_status: 'consent verified' },
  ],
}))

const STUDY_COMPLETED = {
  study_id: DEMO_STUDY_ID, id: DEMO_STUDY_ID,
  study_name: 'Federated AMD Progression — 3-site pilot', name: 'Federated AMD Progression — 3-site pilot',
  researcher_name: 'Dr J. Ohanebo', user_email: 'j.ohanebo@dundee.ac.uk',
  institution: 'University of Dundee',
  status: 'completed', architecture: 'resnet18', model: 'resnet18', dataset: 'octmnist',
  data_description: 'Archived OCT volumes reactivated at 2 institutions — data never left either site.',
  num_rounds: 6, total_rounds: 6, current_round: 6, local_epochs: 2, num_classes: 4,
  class_names: CLASS_NAMES,
  dp_enabled: true, dp_epsilon: 3.0, dp_epsilon_spent: 2.41, dp_delta: 1e-5, dp_noise_multiplier: 1.1,
  final_accuracy: 0.914, final_loss: 0.2841,
  macro_f1: 0.893, weighted_f1: 0.902, cohen_kappa: 0.854,
  confidence_intervals: { accuracy: { ci_lower: 0.891, ci_upper: 0.933 }, f1: { ci_lower: 0.868, ci_upper: 0.916 } },
  per_class_accuracy: ROUNDS[5].per_class_accuracy,
  per_class_metrics: {
    'No AMD': { precision: 0.95, recall: 0.96, f1: 0.955, support: 812 },
    'Early AMD': { precision: 0.88, recall: 0.86, f1: 0.87, support: 640 },
    'Intermediate AMD': { precision: 0.85, recall: 0.84, f1: 0.845, support: 511 },
    'Advanced AMD': { precision: 0.93, recall: 0.94, f1: 0.935, support: 437 },
  },
  round_results: ROUNDS, rounds: ROUNDS,
  nodes: ['moorfields-arc-01', 'edinburgh-srin-02'],
  started_at: iso(18, 3), completed_at: iso(18),
}

const STUDY_PROPOSAL = {
  study_id: DEMO_INVITE_STUDY_ID, id: DEMO_INVITE_STUDY_ID,
  study_name: 'Glaucoma progression from archived visual fields', name: 'Glaucoma progression from archived visual fields',
  researcher_name: 'Dr J. Ohanebo', user_email: 'j.ohanebo@dundee.ac.uk',
  institution: 'University of Dundee',
  status: 'pending', architecture: 'resnet18', model: 'resnet18', dataset: 'octmnist',
  data_description: 'Awaiting institutional acceptance — training starts only after every invited node consents.',
  num_rounds: 8, total_rounds: 8, current_round: 0, local_epochs: 2,
  dp_enabled: true, dp_epsilon: 3.0, dp_delta: 1e-5,
  round_results: [], rounds: [], nodes: [],
  started_at: null, completed_at: null,
}

const AUDIT_EVENTS = [
  { event_id: 'ae1', timestamp: iso(22), event_type: 'study_created' },
  { event_id: 'ae2', timestamp: iso(20), event_type: 'invitation_accepted' },
  { event_id: 'ae3', timestamp: iso(19), event_type: 'invitation_accepted' },
  { event_id: 'ae4', timestamp: iso(18, 3), event_type: 'training_started' },
  ...ROUNDS.map((r, i) => ({ event_id: `ar${i}`, timestamp: iso(18, 2.5 - i * 0.4), event_type: 'round_completed', round: r.round, global_accuracy: r.global_accuracy })),
  { event_id: 'ae5', timestamp: iso(18), event_type: 'study_completed', final_accuracy: 0.914 },
]

const CERT_ID = 'UDST-2026-DEMO-0001'
const CERTS = {
  certificates: [
    { cert_id: CERT_ID, subject: { entity_type: 'model', entity_id: DEMO_STUDY_ID }, issued_at: iso(18) },
    { cert_id: 'UDST-2026-DEMO-0002', subject: { entity_type: 'study', entity_id: DEMO_STUDY_ID }, issued_at: iso(17) },
  ],
}
const CERT_VERDICT = { valid: true, signature_valid: true, audit_anchor_in_chain: true, audit_chain_valid_now: true, registry_chain_intact: true }

const DP_LEDGER = {
  datasets: [
    { dataset_key: 'moorfields:amd-oct', epsilon_spent: 2.41, budget: 10.0, exhausted: false },
    { dataset_key: 'lothian:srin-amd', epsilon_spent: 4.87, budget: 10.0, exhausted: false },
    { dataset_key: 'demo:exhausted-example', epsilon_spent: 10.0, budget: 10.0, exhausted: true },
  ],
}
const DP_CHARGES = {
  'moorfields:amd-oct': [
    { charged_at: iso(18), epsilon: 2.41, cumulative: 2.41, context: { purpose: 'AMD pilot — DP-SGD training' }, actor: 'j.ohanebo@dundee.ac.uk' },
  ],
  'lothian:srin-amd': [
    { charged_at: iso(25), epsilon: 2.46, cumulative: 2.46, context: { purpose: 'Cohort feasibility count' }, actor: 'j.ohanebo@dundee.ac.uk' },
    { charged_at: iso(18), epsilon: 2.41, cumulative: 4.87, context: { purpose: 'AMD pilot — DP-SGD training' }, actor: 'j.ohanebo@dundee.ac.uk' },
  ],
  'demo:exhausted-example': [
    { charged_at: iso(40), epsilon: 10.0, cumulative: 10.0, context: { purpose: 'Illustration: budget fully spent — platform now refuses further releases' }, actor: 'demo' },
  ],
}

const INDEX_SUMMARY = {
  institutions: 3, archived_files_indexed: 187420,
  jurisdictions: { UK: 3 }, modalities: ['OCT', 'fundus', 'visual_field'],
  sdc_note: 'Cell counts below the disclosure threshold (5) are suppressed and shown as <5.',
}
const INDEX_PROFILES = {
  profiles: [
    { node_id: 'moorfields-arc-01', institution: 'Moorfields Eye Hospital', jurisdiction: 'UK', modalities: { OCT: 96200, fundus: 31400 }, year_range: [2011, 2025], total_gb: 2140, profiled_at: iso(12), sdc: { min_cell_count: 5 } },
    { node_id: 'edinburgh-srin-02', institution: 'University of Edinburgh / NHS Lothian', jurisdiction: 'UK', modalities: { OCT: 41300, fundus: 18100, visual_field: null }, year_range: [2014, 2025], total_gb: 890, profiled_at: iso(9), sdc: { min_cell_count: 5 } },
  ],
}

const EVIDENCE_FRAMEWORKS = {
  jurisdictions: {
    UK: 'UK — Five Safes and NHS DSPT control mapping',
    EU: 'EU — GDPR and EHDS control mapping',
    US: 'US — HIPAA and Common Rule control mapping',
  },
}
const EVIDENCE_PACK = {
  pack_id: 'EVP-2026-DEMO-UK',
  certificate_id: 'UDST-2026-DEMO-0003',
  summary: { verified: 6, attested: 2, manual: 1 },
  controls: [
    { control_id: 'FS-1', requirement: 'Safe data — patient-level data never leaves the institution', status: 'verified', evidence: 'Outbound-only node architecture; lineage shows no dataset egress events' },
    { control_id: 'FS-2', requirement: 'Safe outputs — disclosure control on all releases', status: 'verified', evidence: 'SDC min cell count 5 enforced; DP epsilon ledger charge on chain' },
    { control_id: 'FS-3', requirement: 'Safe projects — study approved before data touched', status: 'verified', evidence: 'Invitation acceptance + DUA acknowledgement precede training start in audit chain' },
    { control_id: 'DSPT-4', requirement: 'Tamper-evident audit of governance actions', status: 'verified', evidence: 'Hash-chained audit log; verification endpoint returns chain-intact' },
    { control_id: 'DSPT-7', requirement: 'MFA on privileged access', status: 'verified', evidence: 'TOTP enforced for admin operations (AAL2)' },
    { control_id: 'FS-4', requirement: 'Safe people — verified institutional accounts', status: 'verified', evidence: 'Institutional domain verification at signup' },
    { control_id: 'DSPT-9', requirement: 'Supply-chain integrity of deployed node', status: 'attested', evidence: 'cosign keyless signature + CycloneDX SBOM on node image' },
    { control_id: 'FS-5', requirement: 'Safe settings — TRE-aligned environment', status: 'attested', evidence: 'SATRE self-assessment mapping (in progress)' },
    { control_id: 'ORG-1', requirement: 'Organisational certification (Cyber Essentials)', status: 'manual', evidence: 'In process, 2026 — see Trust page' },
  ],
  markdown: '# Governance Evidence Pack — EVP-2026-DEMO-UK\n\nDemo pack. In production this document is assembled from live platform state and certified so reviewers can prove it was never hand-edited.\n',
}

const DUA_TEXT = `UNDOSATECH DATA USE AGREEMENT (SUMMARY)

1. Patient-level data remains on institutional infrastructure at all times.
2. Only aggregate, disclosure-controlled model updates are transmitted.
3. The study runs only after every invited institution accepts.
4. Withdrawal: an institution may withdraw at any time; its node stops
   participating from the next round and the withdrawal is recorded on the
   audit chain.
5. Retention: model updates are retained for the study's audit period;
   no other institutional material is retained.

(Demo text — the full DUA is available on request.)`

// ── Router ────────────────────────────────────────────────────────────────────

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const notInDemo = (what) => json({ detail: `${what} is disabled in demo mode — sign up to use it for real.` }, 403)

const nodeInvitations = (nodeId) => INVITATIONS.filter(i => i.node_id === nodeId)
const studyInvitations = (studyId) => INVITATIONS.filter(i => i.study_id === studyId)

function route(path, method, body) {
  // studies
  if (path === '/studies' && method === 'GET') return json({ studies: [STUDY_PROPOSAL, STUDY_COMPLETED] })
  if (path === '/studies' && method === 'POST') return notInDemo('Launching studies')
  let m
  if ((m = path.match(/^\/studies\/([^/]+)$/)) && method === 'GET') {
    const s = [STUDY_COMPLETED, STUDY_PROPOSAL].find(x => x.study_id === m[1])
    return s ? json(s) : json({ detail: 'Not found' }, 404)
  }
  if ((m = path.match(/^\/studies\/([^/]+)\/audit$/))) {
    return json({ events: m[1] === DEMO_STUDY_ID ? AUDIT_EVENTS : [] })
  }
  if (path.match(/^\/studies\/[^/]+\/audit\/export$/)) {
    const csv = 'timestamp,event_type,detail\n' + AUDIT_EVENTS.map(e => `${e.timestamp},${e.event_type},${e.round || e.final_accuracy || ''}`).join('\n')
    return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }
  if ((m = path.match(/^\/studies\/([^/]+)\/invitations$/))) return json(studyInvitations(m[1]))
  if ((m = path.match(/^\/studies\/([^/]+)\/invite$/)) && method === 'POST') {
    const study = [STUDY_COMPLETED, STUDY_PROPOSAL].find(x => x.study_id === m[1])
    for (const nodeId of body?.node_ids || []) {
      const node = NODES.find(n => n.node_id === nodeId)
      INVITATIONS.push({
        id: `demo-inv-${INVITATIONS.length + 1}`, study_id: m[1], study_name: study?.study_name || m[1],
        node_id: nodeId, status: 'pending', responded_at: null,
        invited_by_email: DEMO_USER.email, invited_at: new Date().toISOString(),
        message: body?.message || '',
        governance: body?.governance ? { ...GOV_AMD, ...body.governance } : null,
        fl_nodes: { institution_name: node?.institution_name || nodeId, institution_domain: node?.institution_domain || '' },
      })
    }
    return json({ ok: true })
  }
  if (path.match(/^\/studies\/[^/]+\/download/)) return notInDemo('Model download')
  if (path.match(/^\/studies\/[^/]+\/compliance-pack/)) return notInDemo('Compliance packs')
  if (path.match(/^\/studies\/[^/]+\/cancel$/)) return notInDemo('Cancelling')

  // invitations
  if ((m = path.match(/^\/invitations\/([^/]+)\/(accept|decline|withdraw)$/))) {
    const inv = INVITATIONS.find(i => i.id === m[1])
    if (!inv) return json({ detail: 'Not found' }, 404)
    inv.status = m[2] === 'accept' ? 'accepted' : m[2] === 'decline' ? 'declined' : 'withdrawn'
    inv.responded_at = new Date().toISOString()
    if (m[2] === 'decline') inv.decline_reason = body?.reason || 'Declined in demo'
    return json({ ok: true, status: inv.status })
  }
  if (path === '/dua') return json({ text: DUA_TEXT })

  // nodes
  if (path === '/nodes/list') return json(NODES)
  if (path === '/nodes/register' && method === 'POST') {
    const id = body?.node_id || `demo-node-${NODES.length + 1}`
    NODES.push({
      node_id: id, institution_name: body?.institution_name || 'Demo Institution',
      institution_domain: body?.institution_domain || 'example.ac.uk', contact_email: body?.contact_email || '',
      status: 'pending', connectivity: 'offline', gpu_available: !!body?.gpu_available,
      supported_models: body?.supported_models || [], max_samples: body?.max_samples || null,
      host: 'outbound-only', port: 443, tags: body?.tags || [],
      registered_at: new Date().toISOString(), approved_at: null, last_heartbeat: null, recent_heartbeats: [],
    })
    return json({ node_id: id, api_key: 'demo-api-key-not-real-do-not-use', message: 'Demo registration — this node exists only in your browser tab.' })
  }
  if ((m = path.match(/^\/nodes\/([^/]+)\/(approve|suspend)$/)) && method === 'POST') {
    const node = NODES.find(n => n.node_id === m[1])
    if (!node) return json({ detail: 'Not found' }, 404)
    node.status = m[2] === 'approve' ? 'active' : 'suspended'
    if (m[2] === 'approve') node.approved_at = new Date().toISOString()
    return json({ status: node.status })
  }
  if ((m = path.match(/^\/nodes\/([^/]+)\/invitations$/))) return json(nodeInvitations(m[1]))
  if ((m = path.match(/^\/nodes\/([^/]+)$/))) {
    const node = NODES.find(n => n.node_id === m[1])
    return node ? json(node) : json({ detail: 'Not found' }, 404)
  }

  // trust center
  if (path === '/certificates' && method === 'GET') return json(CERTS)
  if (path === '/certificates/public-key') return json({ algorithm: 'Ed25519', public_key_hex: 'demo0000'.repeat(8) })
  if (path === '/certificates/issue') return notInDemo('Issuing certificates')
  if (path.match(/^\/certificates\/[^/]+\/verify$/)) return json(CERT_VERDICT)
  if (path === '/evidence/frameworks') return json(EVIDENCE_FRAMEWORKS)
  if (path === '/evidence/pack' && method === 'POST') return json(EVIDENCE_PACK)
  if (path === '/dp/ledger') return json(DP_LEDGER)
  if ((m = path.match(/^\/dp\/ledger\/(.+)$/))) {
    const key = decodeURIComponent(m[1])
    return json({ dataset_key: key, charges: DP_CHARGES[key] || [] })
  }
  if (path === '/index/summary') return json(INDEX_SUMMARY)
  if (path === '/index') return json(INDEX_PROFILES)

  // launch form + misc
  if (path === '/datasets/connected') return json([])
  if (path === '/compute/availability') return json({ gpu_available: false })

  return null
}

export function installDemoApi() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, opts) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const base = API_BASES.find(b => url.startsWith(b))
    if (!base) return realFetch(input, opts)
    const path = url.slice(base.length).split('?')[0]
    const method = ((opts && opts.method) || 'GET').toUpperCase()
    let body = null
    if (opts && typeof opts.body === 'string') { try { body = JSON.parse(opts.body) } catch { body = null } }
    const res = route(path, method, body)
    return res || json({ detail: 'This feature is not available in demo mode.' }, 404)
  }
}

// Call once at app module load: honours ?demo=1 links, then installs the
// interceptor before any component issues its first fetch.
export function demoBoot() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('demo')) {
      sessionStorage.setItem(DEMO_FLAG, '1')
      params.delete('demo')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  } catch { /* sessionStorage or history unavailable */ }
  if (isDemoMode()) installDemoApi()
}
