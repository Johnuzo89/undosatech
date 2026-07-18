import { useState } from 'react'
import { DEMO_STUDY_ID, DEMO_INVITE_STUDY_ID, exitDemoMode } from '../lib/demoMode'

const ROLE_STYLE = {
  Researcher:       { background: 'rgba(0,122,255,0.12)', color: '#0A66C2' },
  'Data custodian': { background: 'rgba(50,215,75,0.14)', color: '#1B7F3B' },
  Reviewer:         { background: 'rgba(175,82,222,0.14)', color: '#7A2BB0' },
}

const STEPS = [
  {
    role: 'Reviewer', title: 'Welcome — a 10-minute walkthrough',
    body: 'This is the real UndosaTech portal running on sample data — no account, and nothing you do here is saved. The tour follows one study through all three roles: the researcher who proposes it, the data custodian who approves it, and the reviewer who verifies the result.',
  },
  {
    nav: { tab: 'data', sub: 'catalogue' },
    role: 'Researcher', title: 'Find archived data worth reactivating',
    body: 'The catalogue lists governed cohorts contributed by institutions — modality, disease area, sample size, ethics reference, and access conditions. The data itself is not here and never will be: only descriptions. A researcher applies for access; the data holder decides.',
  },
  {
    nav: { studyId: DEMO_INVITE_STUDY_ID, studyTab: 'invitations' },
    role: 'Researcher', title: 'A study starts as a governance request',
    body: 'Nothing trains until every invited institution consents. Expand the 📋 Governance package on the pending invitation — research question, ethics status, requested variables, privacy settings, retention, withdrawal — then press Accept to see the review-and-DUA step every institution goes through. That acknowledgement lands on the audit chain.',
  },
  {
    nav: { tab: 'nodes' },
    role: 'Data custodian', title: 'The institution runs the node — and stays in control',
    body: 'Each institution deploys an outbound-only Docker node next to its archive: no inbound ports, signed container images, and heartbeats you can inspect. One node here is still pending — open it and approve it, exactly as an institutional admin would after their own verification checks.',
  },
  {
    nav: { studyId: DEMO_STUDY_ID, studyTab: 'live' },
    role: 'Researcher', title: 'Training happens where the data lives',
    body: 'This pilot trained across two institutions. The live log shows each round: local training at each site, only model updates returned, aggregated under differential privacy (ε budget shown at the top). Flick through the chart and per-class tabs.',
  },
  {
    nav: { studyId: DEMO_STUDY_ID, studyTab: 'report' },
    role: 'Researcher', title: 'A publication-ready record',
    body: 'Every completed study produces a structured report — per-class metrics, confidence intervals, DP parameters, and a citable methods paragraph. The audit tab beside it holds the tamper-evident event trail for the whole study.',
  },
  {
    nav: { tab: 'governance', sub: 'trust' },
    role: 'Reviewer', title: 'Trust Center — proof, not promises',
    body: 'Open the 🏅 Certificates tab and press Verify on UDST-2026-DEMO-0001. Certificates bind an output to its lineage, disclosure settings, and the audit chain, signed with a published key — a journal or ethics committee can check one offline without trusting our servers.',
  },
  {
    nav: { tab: 'governance', sub: 'trust' },
    role: 'Reviewer', title: 'Privacy budgets are enforced, not advisory',
    body: 'In the ε Privacy Ledger tab, every dataset has a lifetime differential-privacy budget. Each query or training run spends from it, every charge is on the audit chain, and when a budget is exhausted the platform refuses further releases — you can see one exhausted example.',
  },
  {
    nav: { tab: 'governance', sub: 'trust' },
    role: 'Reviewer', title: 'Evidence packs for your governance office',
    body: 'In the 📋 Evidence Packs tab, pick a jurisdiction and generate a pack for the completed study. It maps live platform evidence to UK (Five Safes · DSPT), EU (GDPR · EHDS), or US (HIPAA · Common Rule) controls — support for your institution\'s own compliance assessment, not a substitute for it.',
  },
  {
    role: 'Reviewer', title: 'That\'s the whole loop',
    body: 'Data catalogued → study proposed → institutions consent → training runs where data lives → outputs disclosure-controlled, budgeted, and certified. To see it on your own archive, email hello@undosatech.com or register a node from the Nodes tab.',
  },
]

export default function DemoTour({ onNavigate }) {
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState(true)

  const goTo = (i) => {
    const s = STEPS[i]
    setStep(i)
    if (s.nav) onNavigate(s.nav)
  }

  const roleStyle = ROLE_STYLE[STEPS[step].role]

  return (
    <>
      {/* persistent demo banner */}
      <div style={{ position: 'fixed', left: 14, bottom: 14, zIndex: 400, display: 'flex', gap: 8, alignItems: 'center', background: '#1D1D1F', color: '#fff', borderRadius: 99, padding: '8px 8px 8px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: 12.5, fontWeight: 600 }}>
        <span>🧪 Demo — sample data</span>
        {!open && (
          <button onClick={() => { setOpen(true); goTo(step) }}
            style={{ padding: '5px 12px', borderRadius: 99, border: 'none', background: '#007AFF', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ▶ Resume tour
          </button>
        )}
        <button onClick={exitDemoMode}
          style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid rgba(255,255,255,0.25)', background: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          Exit
        </button>
      </div>

      {/* tour card */}
      {open && (
        <div style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 400, width: 'min(360px, calc(100vw - 28px))', background: '#fff', borderRadius: 18, boxShadow: '0 16px 48px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.05)', padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ ...roleStyle, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {STEPS[step].role}
            </span>
            <button onClick={() => setOpen(false)} title="Hide tour"
              style={{ background: 'rgba(0,0,0,0.05)', border: 'none', color: '#8E8E93', width: 26, height: 26, borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1D1D1F', marginBottom: 6, letterSpacing: '-0.01em' }}>{STEPS[step].title}</div>
          <div style={{ fontSize: 12.5, color: '#48484A', lineHeight: 1.65, marginBottom: 14 }}>{STEPS[step].body}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              {STEPS.map((_, i) => (
                <div key={i} style={{ width: 7, height: 7, borderRadius: 99, background: i === step ? '#007AFF' : i < step ? 'rgba(0,122,255,0.35)' : 'rgba(0,0,0,0.1)', transition: 'background 0.2s' }} />
              ))}
            </div>
            {step > 0 && (
              <button onClick={() => goTo(step - 1)}
                style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#6E6E73', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                Back
              </button>
            )}
            {step < STEPS.length - 1
              ? <button onClick={() => goTo(step + 1)}
                  style={{ padding: '7px 18px', borderRadius: 10, border: 'none', background: '#007AFF', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,122,255,0.3)' }}>
                  Next →
                </button>
              : <button onClick={exitDemoMode}
                  style={{ padding: '7px 18px', borderRadius: 10, border: 'none', background: '#1D1D1F', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                  Finish &amp; exit
                </button>}
          </div>
        </div>
      )}
    </>
  )
}
