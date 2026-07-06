import { useState, useEffect, useCallback, useMemo } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app'
const card = { background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 16 }
const mono = { fontFamily: 'ui-monospace,SFMono-Regular,monospace' }

const STATUS_STYLE = {
  verified: { background: 'rgba(50,215,75,0.12)', color: '#1B7F3B' },
  attested: { background: 'rgba(0,122,255,0.10)', color: '#0A66C2' },
  manual:   { background: 'rgba(255,159,10,0.14)', color: '#B25000' },
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.manual
  return <span style={{ ...s, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>{status}</span>
}

function VerdictChips({ result }) {
  const checks = [
    ['Signature', result.signature_valid],
    ['Audit anchor', result.audit_anchor_in_chain],
    ['Audit chain now', result.audit_chain_valid_now],
    ['Registry chain', result.registry_chain_intact],
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {checks.map(([label, ok]) => (
        <span key={label} style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: ok ? 'rgba(50,215,75,0.12)' : 'rgba(255,59,48,0.12)', color: ok ? '#1B7F3B' : '#C4281C' }}>
          {ok ? '✓' : '✗'} {label}
        </span>
      ))}
    </div>
  )
}

function BudgetBar({ spent, budget }) {
  const pct = Math.min(spent / budget, 1)
  const color = pct < 0.5 ? '#32D74B' : pct < 0.8 ? '#FF9F0A' : '#FF3B30'
  return (
    <div style={{ height: 8, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden', minWidth: 120 }}>
      <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 99, transition: 'width 0.4s' }} />
    </div>
  )
}

// ── Certificates ──────────────────────────────────────────────────────────────
function Certificates({ headers, studies }) {
  const [certs, setCerts] = useState([])
  const [pubkey, setPubkey] = useState(null)
  const [verifying, setVerifying] = useState(null)   // cert_id being verified
  const [verdicts, setVerdicts] = useState({})       // cert_id -> verify result
  const [lookupId, setLookupId] = useState('')
  const [issueType, setIssueType] = useState('study')
  const [issueId, setIssueId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/certificates`, { headers })
      if (r.ok) setCerts((await r.json()).certificates || [])
    } catch { /* offline */ }
    try {
      const r = await fetch(`${API}/certificates/public-key`)
      if (r.ok) setPubkey(await r.json())
    } catch { /* offline */ }
  }, [headers])

  useEffect(() => { load() }, [load])

  const verify = async (certId) => {
    setVerifying(certId); setError(null)
    try {
      const r = await fetch(`${API}/certificates/${encodeURIComponent(certId)}/verify`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Verification failed')
      setVerdicts(v => ({ ...v, [certId]: d }))
    } catch (e) { setError(e.message) }
    finally { setVerifying(null) }
  }

  const issue = async () => {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`${API}/certificates/issue`, {
        method: 'POST', headers,
        body: JSON.stringify({ entity_type: issueType, entity_id: issueId.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Issue failed')
      setIssueId('')
      await load()
      verify(d.payload.cert_id)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const completedStudies = (studies || []).filter(s => s.status === 'completed')

  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Issue a certificate</div>
        <div style={{ fontSize: 12, color: '#6E6E73', marginBottom: 12 }}>
          Binds an output to its provenance chain, disclosure settings, and the audit log tip — signed and independently verifiable. Completed models are certified automatically.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={issueType} onChange={e => setIssueType(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, background: '#FAFAFA' }}>
            {['study', 'model', 'synthetic_export', 'query_result', 'analytics_result'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={issueId} onChange={e => setIssueId(e.target.value)} placeholder="entity id (e.g. study id)"
            style={{ flex: 1, minWidth: 200, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, background: '#FAFAFA', ...mono }} />
          <button onClick={issue} disabled={busy || !issueId.trim()}
            style={{ padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#007AFF', color: '#fff', opacity: busy || !issueId.trim() ? 0.5 : 1 }}>
            {busy ? 'Issuing…' : '🏅 Issue'}
          </button>
        </div>
        {issueType === 'study' && completedStudies.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {completedStudies.slice(0, 6).map(s => (
              <button key={s.study_id || s.id} onClick={() => setIssueId(s.study_id || s.id)}
                style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(0,122,255,0.3)', background: 'rgba(0,122,255,0.06)', color: '#007AFF', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                {(s.name || s.study_name || 'study').slice(0, 28)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Verify any certificate — no account needed</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={lookupId} onChange={e => setLookupId(e.target.value)} placeholder="UDST-2026-…"
              style={{ padding: '7px 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 12.5, background: '#FAFAFA', ...mono }} />
            <button onClick={() => lookupId.trim() && verify(lookupId.trim())} disabled={!lookupId.trim()}
              style={{ padding: '7px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(0,122,255,0.4)', background: 'rgba(0,122,255,0.06)', color: '#007AFF' }}>
              Verify
            </button>
          </div>
        </div>
        {lookupId.trim() && verdicts[lookupId.trim()] && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: verdicts[lookupId.trim()].valid ? 'rgba(50,215,75,0.07)' : 'rgba(255,59,48,0.07)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: verdicts[lookupId.trim()].valid ? '#1B7F3B' : '#C4281C' }}>
              {verdicts[lookupId.trim()].valid ? '✓ Certificate is authentic' : '✗ Certificate failed verification'}
            </div>
            <VerdictChips result={verdicts[lookupId.trim()]} />
          </div>
        )}
      </div>

      {error && <div style={{ ...card, background: 'rgba(255,59,48,0.07)', color: '#C4281C', fontSize: 13 }}>{error}</div>}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Issued certificates {certs.length > 0 && <span style={{ color: '#6E6E73', fontWeight: 400 }}>({certs.length})</span>}</div>
        {certs.length === 0
          ? <div style={{ fontSize: 13, color: '#6E6E73' }}>None yet. Certificates are issued automatically when a federated model completes training, or manually above.</div>
          : certs.map(c => (
            <div key={c.cert_id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: '#1D1D1F' }}>{c.cert_id}</span>
                  <span style={{ fontSize: 12, color: '#6E6E73', marginLeft: 10 }}>
                    {c.subject?.entity_type} · <span style={mono}>{String(c.subject?.entity_id || '').slice(0, 40)}</span>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>{(c.issued_at || '').slice(0, 10)}</span>
                  <button onClick={() => verify(c.cert_id)} disabled={verifying === c.cert_id}
                    style={{ padding: '4px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(0,122,255,0.4)', background: 'rgba(0,122,255,0.06)', color: '#007AFF' }}>
                    {verifying === c.cert_id ? '…' : verdicts[c.cert_id] ? 'Re-verify' : 'Verify'}
                  </button>
                </div>
              </div>
              {verdicts[c.cert_id] && <VerdictChips result={verdicts[c.cert_id]} />}
            </div>
          ))}
      </div>

      {pubkey && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Platform signing key ({pubkey.algorithm})</div>
          <div style={{ ...mono, fontSize: 11.5, color: '#6E6E73', wordBreak: 'break-all', background: '#FAFAFA', padding: '8px 10px', borderRadius: 8 }}>{pubkey.public_key_hex}</div>
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 8, lineHeight: 1.5 }}>
            Anyone can verify certificates offline with this key alone — journals, ethics committees, and regulators never have to trust UndosaTech&apos;s servers.
            <button onClick={() => navigator.clipboard?.writeText(pubkey.public_key_hex)}
              style={{ marginLeft: 8, padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#1D1D1F' }}>
              Copy key
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Evidence Packs ────────────────────────────────────────────────────────────
function EvidencePacks({ headers, studies }) {
  const [frameworks, setFrameworks] = useState({})
  const [jurisdiction, setJurisdiction] = useState('UK')
  const [studyId, setStudyId] = useState('')
  const [pack, setPack] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API}/evidence/frameworks`).then(r => r.json()).then(d => setFrameworks(d.jurisdictions || {})).catch(() => {})
  }, [])

  const FLAGS = { UK: '🇬🇧', EU: '🇪🇺', US: '🇺🇸' }

  const generate = async () => {
    setBusy(true); setError(null); setPack(null)
    try {
      const r = await fetch(`${API}/evidence/pack`, {
        method: 'POST', headers,
        body: JSON.stringify({ study_id: studyId.trim(), jurisdiction }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Generation failed')
      setPack(d)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const download = () => {
    const blob = new Blob([pack.markdown], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${pack.pack_id}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Generate a governance evidence pack</div>
        <div style={{ fontSize: 12, color: '#6E6E73', marginBottom: 14 }}>
          Regulator-ready evidence assembled from live platform state — audit chain, lineage, disclosure controls, privacy ledger. Every pack is certified so reviewers can prove it was never hand-edited.
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {Object.entries(frameworks).map(([code, desc]) => (
            <button key={code} onClick={() => setJurisdiction(code)}
              style={{ flex: 1, minWidth: 180, textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', border: jurisdiction === code ? '2px solid #007AFF' : '1px solid rgba(0,0,0,0.1)', background: jurisdiction === code ? 'rgba(0,122,255,0.05)' : '#fff' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{FLAGS[code] || '🌐'} {code}</div>
              <div style={{ fontSize: 11, color: '#6E6E73', lineHeight: 1.45 }}>{desc.split('—')[1] || desc}</div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={studyId} onChange={e => setStudyId(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, background: '#FAFAFA' }}>
            <option value="">Select a study…</option>
            {(studies || []).map(s => (
              <option key={s.study_id || s.id} value={s.study_id || s.id}>
                {(s.name || s.study_name || s.study_id || s.id)} {s.status ? `(${s.status})` : ''}
              </option>
            ))}
          </select>
          <button onClick={generate} disabled={busy || !studyId.trim()}
            style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#007AFF', color: '#fff', opacity: busy || !studyId.trim() ? 0.5 : 1 }}>
            {busy ? 'Generating…' : '📋 Generate pack'}
          </button>
        </div>
      </div>

      {error && <div style={{ ...card, background: 'rgba(255,59,48,0.07)', color: '#C4281C', fontSize: 13 }}>{error}</div>}

      {pack && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ ...mono, fontSize: 14, fontWeight: 700 }}>{pack.pack_id}</span>
              {pack.certificate_id && <span style={{ fontSize: 11.5, marginLeft: 10, padding: '3px 9px', borderRadius: 99, background: 'rgba(50,215,75,0.12)', color: '#1B7F3B', fontWeight: 600 }}>🏅 certified {pack.certificate_id}</span>}
            </div>
            <button onClick={download}
              style={{ padding: '6px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(0,122,255,0.4)', background: 'rgba(0,122,255,0.06)', color: '#007AFF' }}>
              ⬇ Download .md
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {['verified', 'attested', 'manual'].map(s => (
              <span key={s} style={{ ...STATUS_STYLE[s], fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99 }}>
                {pack.summary?.[s] ?? 0} {s}
              </span>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Control', 'Requirement', 'Status', 'Evidence'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid rgba(0,0,0,0.08)', color: '#6E6E73', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pack.controls.map(c => (
                  <tr key={c.control_id}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', ...mono, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.control_id}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', minWidth: 180 }}>{c.requirement}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}><StatusPill status={c.status} /></td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', color: '#6E6E73', minWidth: 220 }}>{c.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Privacy Ledger ────────────────────────────────────────────────────────────
function PrivacyLedger({ headers }) {
  const [ledger, setLedger] = useState(null)
  const [detail, setDetail] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/dp/ledger`, { headers })
      if (r.ok) setLedger(await r.json())
    } catch { /* offline */ }
  }, [headers])

  useEffect(() => { load() }, [load])

  const openDetail = async (key) => {
    try {
      const r = await fetch(`${API}/dp/ledger/${encodeURIComponent(key)}`, { headers })
      if (r.ok) setDetail(await r.json())
    } catch { /* offline */ }
  }

  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Lifetime privacy budgets — per dataset, across all studies</div>
        <div style={{ fontSize: 12, color: '#6E6E73', marginBottom: 14 }}>
          Every DP query and synthetic export consumes ε from the dataset it touched (sequential composition — the conservative bound). When a budget is exhausted, the platform refuses further releases. Every charge is on the tamper-evident audit chain.
        </div>
        {!ledger || ledger.datasets.length === 0
          ? <div style={{ fontSize: 13, color: '#6E6E73' }}>No DP releases recorded yet. Budgets appear here the first time a dataset is queried.</div>
          : ledger.datasets.map(d => (
            <div key={d.dataset_key} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', flexWrap: 'wrap' }}>
              <button onClick={() => openDetail(d.dataset_key)}
                style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: '#007AFF', background: 'none', border: 'none', cursor: 'pointer', padding: 0, minWidth: 140, textAlign: 'left' }}>
                {d.dataset_key}
              </button>
              <div style={{ flex: 1, minWidth: 140 }}><BudgetBar spent={d.epsilon_spent} budget={d.budget} /></div>
              <span style={{ fontSize: 12, fontWeight: 600, color: d.exhausted ? '#C4281C' : '#1D1D1F', whiteSpace: 'nowrap' }}>
                ε {d.epsilon_spent.toFixed(2)} / {d.budget}
              </span>
              {d.exhausted && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: 'rgba(255,59,48,0.12)', color: '#C4281C' }}>EXHAUSTED</span>}
            </div>
          ))}
      </div>

      {detail && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Charge history — <span style={mono}>{detail.dataset_key}</span></div>
            <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', color: '#6E6E73', cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>{['When', 'ε', 'Cumulative', 'Purpose', 'Actor'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: '2px solid rgba(0,0,0,0.08)', color: '#6E6E73', fontWeight: 600 }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {detail.charges.map((c, i) => (
                  <tr key={i}>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{(c.charged_at || '').replace('T', ' ').slice(0, 16)}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', ...mono }}>{c.epsilon}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', ...mono }}>{c.cumulative}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>{c.context?.purpose || '—'}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', color: '#6E6E73' }}>{c.actor || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reactivation Index ────────────────────────────────────────────────────────
function ReactivationIndex({ headers }) {
  const [summary, setSummary] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [jurisdiction, setJurisdiction] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/index/summary`)
      if (r.ok) setSummary(await r.json())
    } catch { /* offline */ }
    try {
      const qs = jurisdiction ? `?jurisdiction=${jurisdiction}` : ''
      const r = await fetch(`${API}/index${qs}`, { headers })
      if (r.ok) setProfiles((await r.json()).profiles || [])
    } catch { /* offline */ }
  }, [headers, jurisdiction])

  useEffect(() => { load() }, [load])

  const stat = (label, value) => (
    <div style={{ flex: 1, minWidth: 120, textAlign: 'center', padding: '14px 10px' }}>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: '#1D1D1F' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#6E6E73', marginTop: 2 }}>{label}</div>
    </div>
  )

  return (
    <div>
      {summary && (
        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', padding: 8 }}>
          {stat('Institutions indexed', summary.institutions)}
          {stat('Archived files', summary.archived_files_indexed.toLocaleString())}
          {stat('Jurisdictions', Object.keys(summary.jurisdictions || {}).length)}
          {stat('Modalities', (summary.modalities || []).length)}
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Archive holdings across the network</div>
          <select value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 12.5, background: '#FAFAFA' }}>
            <option value="">All jurisdictions</option>
            {['UK', 'US', 'EU', 'CA', 'AU', 'AFRICA', 'OTHER'].map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        {profiles.length === 0
          ? <div style={{ fontSize: 13, color: '#6E6E73', lineHeight: 1.6 }}>
              No archives indexed{jurisdiction ? ` in ${jurisdiction}` : ''} yet. Institutional nodes are profiled <b>automatically</b> when they come online:
              the node scans its own archive locally and shares only aggregate counts — no filename, path, or image ever leaves the institution.
            </div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>{['Institution', 'Jurisdiction', 'Holdings', 'Years', 'Size', 'Profiled'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid rgba(0,0,0,0.08)', color: '#6E6E73', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {profiles.map(p => (
                    <tr key={p.node_id}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', fontWeight: 600 }}>{p.institution}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: 'rgba(0,122,255,0.08)', color: '#0A66C2' }}>{p.jurisdiction}</span>
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {Object.entries(p.modalities || {}).map(([m, c]) => (
                            <span key={m} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#F5F5F7', color: '#1D1D1F' }}>
                              {m}: <b>{c === null ? `<${p.sdc?.min_cell_count ?? 5}` : c.toLocaleString()}</b>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{p.year_range ? `${p.year_range[0]}–${p.year_range[1]}` : '—'}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{p.total_gb} GB</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', color: '#6E6E73', whiteSpace: 'nowrap' }}>{(p.profiled_at || '').slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {summary?.sdc_note && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>🛡 {summary.sdc_note}</div>}
      </div>
    </div>
  )
}

// ── Trust Center shell ────────────────────────────────────────────────────────
export default function TrustCenter({ session, studies }) {
  const [tab, setTab] = useState('certificates')
  const headers = useMemo(() => ({ Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }), [session?.access_token])

  const SECTIONS = [
    ['certificates', '🏅 Certificates'],
    ['evidence', '📋 Evidence Packs'],
    ['ledger', 'ε Privacy Ledger'],
    ['index', '🗂 Reactivation Index'],
  ]

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#1D1D1F', marginBottom: 4 }}>Trust Center</h1>
      <p style={{ fontSize: 13, color: '#6E6E73', marginBottom: 16 }}>
        Cryptographically verifiable provenance, regulator-ready evidence, enforced privacy budgets, and the federated archive index
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: tab === id ? 600 : 500, cursor: 'pointer', border: 'none', background: tab === id ? '#007AFF' : 'rgba(0,0,0,0.05)', color: tab === id ? '#fff' : '#6E6E73', transition: 'all 0.15s' }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'certificates' && <Certificates headers={headers} studies={studies} />}
      {tab === 'evidence' && <EvidencePacks headers={headers} studies={studies} />}
      {tab === 'ledger' && <PrivacyLedger headers={headers} />}
      {tab === 'index' && <ReactivationIndex headers={headers} />}
    </div>
  )
}
