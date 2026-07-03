// portal/src/components/AdminDashboard.jsx

import { useState, useEffect, useCallback } from 'react'
import ObservabilityPanel from './ObservabilityPanel'

const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app'

// ── Shared ────────────────────────────────────────────────────────────────────
const S = {
  card: { background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: '20px 24px', marginBottom: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.03)' },
  th:   { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em', background: '#F5F5F7', borderBottom: '1px solid rgba(0,0,0,0.06)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:   { padding: '12px 14px', fontSize: 13, color: '#1D1D1F', borderBottom: '1px solid rgba(0,0,0,0.04)', verticalAlign: 'middle' },
  inp:  { padding: '9px 14px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, fontSize: 13, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.04)', color: '#1D1D1F' },
}

const btn = (bg, text = '#fff', small = false) => ({
  padding: small ? '5px 12px' : '9px 18px', borderRadius: small ? 8 : 10, border: 'none',
  background: bg, color: text, fontWeight: 600, cursor: 'pointer',
  fontSize: small ? 12 : 13, whiteSpace: 'nowrap', transition: 'opacity 0.15s',
})

function StatusPill({ status }) {
  const map = {
    pending:   ['rgba(255,159,10,0.1)',   '#FF9F0A'],
    approved:  ['rgba(50,215,75,0.1)',    '#1a9e3a'],
    rejected:  ['rgba(255,59,48,0.1)',    '#FF3B30'],
    running:   ['rgba(88,86,214,0.1)',    '#5856D6'],
    completed: ['rgba(50,215,75,0.1)',    '#1a9e3a'],
    failed:    ['rgba(255,59,48,0.1)',    '#FF3B30'],
    cancelled:  ['rgba(142,142,147,0.12)','#8E8E93'],
    stopped:    ['rgba(255,159,10,0.1)',   '#FF9F0A'],
    gpu_queued: ['rgba(124,58,237,0.1)',   '#7c3aed'],
    active:    ['rgba(50,215,75,0.1)',    '#1a9e3a'],
    offline:   ['rgba(142,142,147,0.12)','#8E8E93'],
    suspended: ['rgba(255,59,48,0.1)',    '#FF3B30'],
  }
  const [bg, c] = map[status] || ['rgba(142,142,147,0.12)', '#8E8E93']
  return <span style={{ background: bg, color: c, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{status}</span>
}

function ago(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#1D1D1F', alert, accentColor }) {
  return (
    <div style={{ ...S.card, marginBottom: 0, position: 'relative', borderLeft: accentColor ? `3px solid ${accentColor}` : undefined, paddingLeft: accentColor ? 20 : 24 }}>
      {alert > 0 && <span style={{ position: 'absolute', top: 14, right: 14, background: '#FF3B30', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99 }}>{alert}</span>}
      <div style={{ fontSize: 11, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1, letterSpacing: '-0.03em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#AEAEB2', marginTop: 4, fontWeight: 500 }}>{sub}</div>}
    </div>
  )
}

// ── Reject reason modal ───────────────────────────────────────────────────────
function RejectModal({ request, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 32px 64px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Reject request</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6E6E73' }}>
          Rejecting access for <strong style={{ color: '#1D1D1F' }}>{request.email}</strong> ({request.institution}).
        </p>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#6E6E73', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reason (optional, not emailed)</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Insufficient research justification"
          rows={3}
          style={{ ...S.inp, resize: 'vertical', marginBottom: 16 }}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ ...btn('rgba(0,0,0,0.06)', '#1D1D1F'), flex: 1 }}>Cancel</button>
          <button onClick={() => onConfirm(reason)} style={{ ...btn('#FF3B30'), flex: 1 }}>Confirm reject</button>
        </div>
      </div>
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function Overview({ stats, requests, studies, onTabSwitch }) {
  if (!stats) return <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>Loading stats…</div>
  const pendingReqs = requests.filter(r => r.status === 'pending')
  const recentStudies = studies.slice(0, 6)

  return (
    <div>
      {/* Stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        <StatCard label="Pending requests" value={stats.access_requests.pending} color={stats.access_requests.pending > 0 ? '#FF3B30' : '#1D1D1F'} alert={stats.access_requests.pending} sub={`${stats.access_requests.total} total`} accentColor={stats.access_requests.pending > 0 ? '#FF3B30' : undefined} />
        <StatCard label="Registered users" value={stats.users.total} color="#007AFF" sub="all time" accentColor="#007AFF" />
        <StatCard label="Total studies" value={stats.studies.total} color="#1D1D1F" sub={`${stats.studies.running} running`} />
        <StatCard label="Studies complete" value={stats.studies.completed} color="#1a9e3a" sub={`${stats.studies.failed} failed`} accentColor="#32D74B" />
        <StatCard label="FL nodes" value={stats.nodes.total} color="#5856D6" sub={`${stats.nodes.active} active · ${stats.nodes.pending} pending`} accentColor="#5856D6" />
      </div>

      {/* Pending requests callout */}
      {pendingReqs.length > 0 && (
        <div style={{ background: 'rgba(255,159,10,0.08)', border: '1px solid rgba(255,159,10,0.2)', borderRadius: 14, padding: '14px 18px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#FF9F0A', letterSpacing: '-0.01em' }}>⚠ {pendingReqs.length} access request{pendingReqs.length > 1 ? 's' : ''} awaiting review</div>
            <div style={{ fontSize: 12, color: '#FF9F0A', marginTop: 3, opacity: 0.8 }}>{pendingReqs.map(r => r.email).join(', ')}</div>
          </div>
          <button onClick={() => onTabSwitch('requests')} style={{ ...btn('rgba(255,159,10,0.15)', '#FF9F0A'), padding: '7px 14px', fontSize: 12 }}>Review now →</button>
        </div>
      )}

      {/* Recent studies */}
      {recentStudies.length > 0 && (
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: 'flex', justifyContent: 'space-between', letterSpacing: '-0.01em' }}>
            <span>Recent studies</span>
            <button onClick={() => onTabSwitch('studies')} style={{ ...btn('transparent', '#007AFF', true), padding: 0, fontWeight: 600 }}>View all →</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Study', 'User', 'Dataset', 'Status', 'Accuracy', 'Created'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {recentStudies.map((s, i) => (
                <tr key={s.id || s.study_id} style={{ background: i % 2 === 0 ? '#fff' : 'rgba(0,0,0,0.015)' }}>
                  <td style={S.td}><span style={{ fontWeight: 600 }}>{s.name || s.study_name}</span></td>
                  <td style={{ ...S.td, fontSize: 12, color: '#6E6E73' }}>{s.user_email || '—'}</td>
                  <td style={S.td}>{s.dataset}</td>
                  <td style={S.td}><StatusPill status={s.status} /></td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#1a9e3a' }}>{s.final_accuracy != null ? `${(s.final_accuracy * 100).toFixed(1)}%` : '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#AEAEB2' }}>{ago(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Access Requests tab ───────────────────────────────────────────────────────
function AccessRequests({ session, onStatsRefresh }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [busy, setBusy] = useState({})
  const [msg, setMsg] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/admin/access-requests${filter !== 'all' ? `?status=${filter}` : ''}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      setRequests(await res.json())
    } catch (e) { setMsg({ type: 'error', text: e.message }) }
    finally { setLoading(false) }
  }, [session, filter])

  useEffect(() => { load() }, [load])

  const act = async (id, action, body = {}) => {
    setBusy(b => ({ ...b, [id]: action }))
    setMsg(null)
    try {
      const res = await fetch(`${API}/admin/access-requests/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) {
        const detail = d?.detail
        const msg = typeof detail === 'string' ? detail
          : Array.isArray(detail) ? detail.map(e => e.msg ?? JSON.stringify(e)).join('; ')
          : detail ? JSON.stringify(detail) : 'Request failed'
        throw new Error(msg)
      }
      if (action === 'approve') {
        const emailNote = d.invite_sent
          ? ' — acceptance email sent'
          : ` — email failed: ${d.invite_error || 'unknown error'}`
        setMsg({ type: d.invite_sent ? 'success' : 'warning', text: `✓ Approved ${d.email}${emailNote}` })
      } else if (action === 'resend') {
        const emailNote = d.invite_sent ? 'Email resent successfully' : `Resend failed: ${d.invite_error || 'unknown error'}`
        setMsg({ type: d.invite_sent ? 'success' : 'warning', text: emailNote })
      } else {
        setMsg({ type: 'success', text: `Rejected request #${id}` })
      }
      await load()
      onStatsRefresh()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(b => ({ ...b, [id]: null }))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {['pending', 'approved', 'rejected', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: filter === f ? '#007AFF' : 'rgba(0,0,0,0.05)', color: filter === f ? '#fff' : '#6E6E73', fontWeight: filter === f ? 600 : 500, textTransform: 'capitalize', transition: 'all 0.15s' }}>{f}</button>
        ))}
        <button onClick={load} style={{ ...btn('rgba(0,0,0,0.05)', '#6E6E73', true), marginLeft: 'auto' }}>↻ Refresh</button>
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13, fontWeight: 500,
        background: msg.type === 'success' ? 'rgba(50,215,75,0.1)' : msg.type === 'warning' ? 'rgba(255,159,10,0.1)' : 'rgba(255,59,48,0.1)',
        color:      msg.type === 'success' ? '#1a9e3a' : msg.type === 'warning' ? '#FF9F0A' : '#FF3B30' }}>{msg.text}</div>}

      {loading ? (
        <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>No {filter} requests.</div>
      ) : (
        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', 'Email', 'Institution', 'Role', 'Research Area', 'Submitted', 'Status', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {requests.map((r, i) => (
                <tr key={r.id} style={{ background: r.status === 'pending' ? 'rgba(255,159,10,0.04)' : i % 2 === 0 ? '#fff' : 'rgba(0,0,0,0.015)' }}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{r.full_name || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.email}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.institution}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.role}</td>
                  <td style={{ ...S.td, fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.research_area || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#AEAEB2' }}>{ago(r.created_at)}</td>
                  <td style={S.td}><StatusPill status={r.status} /></td>
                  <td style={S.td}>
                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => act(r.id, 'approve')}
                          disabled={!!busy[r.id]}
                          style={{ ...btn('rgba(50,215,75,0.12)', '#1a9e3a', true) }}
                        >{busy[r.id] === 'approve' ? '…' : '✓ Approve'}</button>
                        <button
                          onClick={() => setRejectTarget(r)}
                          disabled={!!busy[r.id]}
                          style={{ ...btn('rgba(255,59,48,0.1)', '#FF3B30', true) }}
                        >✗ Reject</button>
                      </div>
                    )}
                    {r.status === 'approved' && (
                      <button
                        onClick={() => act(r.id, 'resend')}
                        disabled={!!busy[r.id]}
                        style={{ ...btn('rgba(0,122,255,0.1)', '#007AFF', true) }}
                      >{busy[r.id] === 'resend' ? '…' : '✉ Resend'}</button>
                    )}
                    {r.status === 'rejected' && r.rejection_reason && (
                      <span style={{ fontSize: 11, color: '#AEAEB2' }} title={r.rejection_reason}>Reason recorded</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectTarget && (
        <RejectModal
          request={rejectTarget}
          onConfirm={reason => { act(rejectTarget.id, 'reject', { reason }); setRejectTarget(null) }}
          onCancel={() => setRejectTarget(null)}
        />
      )}
    </div>
  )
}

// ── All Studies tab ───────────────────────────────────────────────────────────
function AllStudies({ studies, loading }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  const filtered = studies.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return (s.name || s.study_name || '').toLowerCase().includes(q)
          || (s.user_email || '').toLowerCase().includes(q)
          || (s.dataset || '').toLowerCase().includes(q)
    }
    return true
  })

  const statuses = ['all', 'running', 'completed', 'failed', 'pending', 'stopped']

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search study name, user, dataset…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...S.inp, maxWidth: 280 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {statuses.map(f => (
            <button key={f} onClick={() => setFilterStatus(f)} style={{ padding: '6px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: filterStatus === f ? '#007AFF' : 'rgba(0,0,0,0.05)', color: filterStatus === f ? '#fff' : '#6E6E73', fontWeight: filterStatus === f ? 600 : 500, textTransform: 'capitalize', transition: 'all 0.15s' }}>{f}</button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#AEAEB2', alignSelf: 'center' }}>{filtered.length} studies</span>
      </div>

      {loading ? (
        <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>No studies found.</div>
      ) : (
        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Study', 'User', 'Model', 'Dataset', 'Rounds', 'Status', 'Accuracy', 'Created'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id || s.study_id} style={{ cursor: 'default', background: i % 2 === 0 ? '#fff' : 'rgba(0,0,0,0.015)' }}>
                  <td style={{ ...S.td, fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || s.study_name}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#6E6E73' }}>{s.user_email || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{s.model || s.architecture || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{s.dataset}</td>
                  <td style={{ ...S.td, fontSize: 12, textAlign: 'center' }}>{s.current_round ?? 0}/{s.total_rounds || s.num_rounds}</td>
                  <td style={S.td}><StatusPill status={s.status} /></td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#1a9e3a' }}>{s.final_accuracy != null ? `${(s.final_accuracy * 100).toFixed(1)}%` : '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#AEAEB2' }}>{ago(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Delete confirm modal ──────────────────────────────────────────────────────
function DeleteUserModal({ user, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 32px 64px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 17, color: '#FF3B30', fontWeight: 700, letterSpacing: '-0.01em' }}>Delete account permanently?</h3>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: '#1D1D1F' }}>
          This will <strong>permanently delete</strong> the Supabase account for:
        </p>
        <p style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 600, color: '#1D1D1F' }}>{user.email}</p>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6E6E73' }}>
          Their studies and data remain but they will not be able to log in. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ ...btn('rgba(0,0,0,0.06)', '#1D1D1F'), flex: 1 }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btn('#FF3B30'), flex: 1 }}>Delete permanently</button>
        </div>
      </div>
    </div>
  )
}

// ── Users tab ─────────────────────────────────────────────────────────────────
function Users({ session }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState({})
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setMsg(null)
    try {
      const res = await fetch(`${API}/admin/users`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || `Server error ${res.status}`)
      setUsers(Array.isArray(d) ? d : [])
    } catch (e) { setMsg({ type: 'error', text: e.message }) }
    finally { setLoading(false) }
  }, [session])

  useEffect(() => { load() }, [load])

  const act = async (userId, action) => {
    setBusy(b => ({ ...b, [userId]: action }))
    setMsg(null)
    const method = action === 'delete' ? 'DELETE' : 'POST'
    const url = action === 'delete'
      ? `${API}/admin/users/${userId}`
      : `${API}/admin/users/${userId}/${action}`
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Action failed')
      setMsg({ type: 'success', text: action === 'delete' ? 'Account deleted.' : action === 'deactivate' ? 'Account deactivated.' : 'Account reactivated.' })
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(b => ({ ...b, [userId]: null }))
    }
  }

  const handleDelete = async (user) => {
    setDeleteTarget(null)
    await act(user.id, 'delete')
  }

  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (u.email || '').toLowerCase().includes(q)
        || (u.full_name || '').toLowerCase().includes(q)
        || (u.institution || '').toLowerCase().includes(q)
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input placeholder="Search by name, email, institution…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.inp, maxWidth: 300 }} />
        <button onClick={load} style={{ ...btn('rgba(0,0,0,0.05)', '#6E6E73', true) }}>↻ Refresh</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#AEAEB2' }}>{filtered.length} users</span>
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13, fontWeight: 500,
        background: msg.type === 'success' ? 'rgba(50,215,75,0.1)' : 'rgba(255,59,48,0.1)',
        color:      msg.type === 'success' ? '#1a9e3a' : '#FF3B30' }}>{msg.text}</div>}

      {loading ? (
        <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : (
        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', 'Email', 'Institution', 'Role', 'Type', 'Status', 'Joined', 'Last sign-in', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id} style={{ background: u.banned ? 'rgba(255,59,48,0.03)' : i % 2 === 0 ? '#fff' : 'rgba(0,0,0,0.015)' }}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{u.full_name || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{u.email}</td>
                  <td style={{ ...S.td, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.institution || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{u.role || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>
                    <span style={{ background: u.account_type === 'approved' ? 'rgba(0,122,255,0.1)' : 'rgba(50,215,75,0.1)', color: u.account_type === 'approved' ? '#007AFF' : '#1a9e3a', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>
                      {u.account_type || 'institutional'}
                    </span>
                  </td>
                  <td style={S.td}>
                    {u.banned
                      ? <span style={{ background: 'rgba(255,59,48,0.1)', color: '#FF3B30', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>banned</span>
                      : <span style={{ background: 'rgba(50,215,75,0.1)', color: '#1a9e3a', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>active</span>
                    }
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: '#AEAEB2' }}>{ago(u.created_at)}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#AEAEB2' }}>{ago(u.last_sign_in_at)}</td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {u.banned ? (
                        <button
                          onClick={() => act(u.id, 'reactivate')}
                          disabled={!!busy[u.id]}
                          style={{ ...btn('rgba(50,215,75,0.1)', '#1a9e3a', true) }}
                        >{busy[u.id] === 'reactivate' ? '…' : '✓ Reactivate'}</button>
                      ) : (
                        <button
                          onClick={() => act(u.id, 'deactivate')}
                          disabled={!!busy[u.id]}
                          style={{ ...btn('rgba(255,159,10,0.1)', '#FF9F0A', true) }}
                        >{busy[u.id] === 'deactivate' ? '…' : '⊘ Deactivate'}</button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(u)}
                        disabled={!!busy[u.id]}
                        style={{ ...btn('rgba(255,59,48,0.1)', '#FF3B30', true) }}
                      >{busy[u.id] === 'delete' ? '…' : '✕ Delete'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <DeleteUserModal
          user={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// ── Node Health tab ───────────────────────────────────────────────────────────
function NodeHealth({ session }) {
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/nodes/list`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) setNodes(await res.json())
    } catch (_) {}
    finally { setLoading(false) }
  }, [session])

  useEffect(() => { load() }, [load])

  function agoMin(iso) {
    if (!iso) return null
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    return `${Math.floor(m/60)}h ago`
  }

  const dot = (conn) => ({
    online:      '#32D74B',
    degraded:    '#FF9F0A',
    unreachable: '#FF3B30',
  }[conn] || '#8E8E93')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{nodes.length} registered nodes</div>
        <button onClick={load} style={{ ...btn('rgba(0,0,0,0.05)', '#6E6E73', true) }}>↻ Refresh</button>
      </div>
      {loading ? (
        <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : nodes.length === 0 ? (
        <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>No nodes registered.</div>
      ) : (
        nodes.map(n => {
          const lastSeen = agoMin(n.last_heartbeat)
          const offlineWarn = n.last_heartbeat && (Date.now() - new Date(n.last_heartbeat).getTime()) > 10 * 60000
          return (
            <div key={n.node_id} style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot(n.connectivity), flexShrink: 0, boxShadow: `0 0 5px ${dot(n.connectivity)}` }} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{n.institution_name}</div>
                <div style={{ fontSize: 11, color: '#8E8E93' }}>{n.node_id} · {n.institution_domain}</div>
              </div>
              <div style={{ fontSize: 12, color: '#6E6E73', minWidth: 100, textAlign: 'right' }}>
                {lastSeen ? `Last seen ${lastSeen}` : 'Never connected'}
              </div>
              <StatusPill status={n.status} />
              {offlineWarn && (
                <span style={{ fontSize: 11, color: '#FF3B30', background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)', borderRadius: 8, padding: '2px 8px', fontWeight: 600 }}>Offline &gt;10 min</span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Main AdminDashboard ───────────────────────────────────────────────────────
function HardwareStatus({ session }) {
  const [hw, setHw] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/hardware`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) setHw(await res.json())
      else setErr('Failed to load hardware info')
    } catch (e) { setErr(e.message) }
  }, [session])

  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id) }, [load])

  const fmt = (bytes) => {
    if (!bytes) return '—'
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
    return `${(bytes / 1e6).toFixed(0)} MB`
  }

  if (err) return <div style={{ color: '#FF3B30', padding: 20 }}>{err}</div>
  if (!hw) return <div style={{ color: '#8E8E93', padding: 40, textAlign: 'center' }}>Loading hardware info…</div>

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>CPU</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#1D1D1F' }}>{hw.cpu.count} cores</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>RAM</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#1D1D1F' }}>{fmt(hw.ram.total_bytes)}</div>
          <div style={{ fontSize: 12, color: '#AEAEB2', marginTop: 4 }}>{fmt(hw.ram.used_bytes)} used</div>
        </div>
        <div style={{ ...S.card, borderLeft: `3px solid ${hw.gpu.available ? '#32D74B' : '#FF9F0A'}` }}>
          <div style={{ fontSize: 11, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>GPU</div>
          <div style={{ fontSize: hw.gpu.available ? 16 : 14, fontWeight: 700, color: hw.gpu.available ? '#1a9e3a' : '#FF9F0A' }}>
            {hw.gpu.available ? hw.gpu.name || 'Available' : 'Not available (CPU plan)'}
          </div>
          {hw.gpu.vram_bytes && <div style={{ fontSize: 12, color: '#AEAEB2', marginTop: 4 }}>{fmt(hw.gpu.vram_bytes)} VRAM</div>}
        </div>
        <div style={{ ...S.card, borderLeft: hw.studies.gpu_queued > 0 ? '3px solid #FF9F0A' : undefined }}>
          <div style={{ fontSize: 11, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>GPU demand</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: hw.studies.gpu_queued > 0 ? '#FF9F0A' : '#1D1D1F' }}>{hw.studies.gpu_queued}</div>
          <div style={{ fontSize: 12, color: '#AEAEB2', marginTop: 4 }}>studies queued for GPU · {hw.studies.running} running</div>
          {hw.studies.gpu_queued >= 3 && !hw.gpu.available && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#FF9F0A', background: 'rgba(255,159,10,0.08)', borderRadius: 8, padding: '6px 10px' }}>
              Consider upgrading to a GPU plan — {hw.studies.gpu_queued} users are waiting
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#AEAEB2', textAlign: 'right' }}>Auto-refreshes every 30s</div>
    </div>
  )
}

// ── Cohort Admin tab ──────────────────────────────────────────────────────────

const MODALITY_OPTS  = ['OCT','fundus','MRI','CT','EEG','histopathology','mixed']
const FORMAT_OPTS    = ['DICOM','BIDS','NIfTI','CSV','mixed']
const ACCESS_OPTS    = ['open','application_required','restricted']
const CONSENT_OPTS   = ['broad_consent','dynamic_consent','waived','anonymised']
const STATUS_OPTS    = ['pending','published','archived']

const STATUS_COLORS = {
  published: { bg: '#f0fdf4', color: '#059669', border: '#a7f3d0' },
  pending:   { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  archived:  { bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb' },
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function CohortFormModal({ cohort, onSave, onClose, session }) {
  const isNew = !cohort
  const blank = {
    name: '', slug: '', description: '', contributing_institution: '',
    modality: 'OCT', disease_area: '', sample_count: '',
    age_range_min: '', age_range_max: '', data_format: 'DICOM',
    imaging_device: '', longitudinal: false, follow_up_years: '',
    access_type: 'application_required', ethics_reference: '',
    consent_basis: 'broad_consent', dspt_compliant: true, ico_registered: true,
    status: 'pending', featured: false, doi: '', description: '',
  }
  const [form, setForm] = useState(isNew ? blank : { ...cohort })
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (k === 'name' && isNew) next.slug = slugify(v)
    return next
  })

  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const payload = {
      ...form,
      sample_count:    form.sample_count    ? +form.sample_count    : null,
      age_range_min:   form.age_range_min   ? +form.age_range_min   : null,
      age_range_max:   form.age_range_max   ? +form.age_range_max   : null,
      follow_up_years: form.follow_up_years ? +form.follow_up_years : null,
    }
    const url  = isNew ? `${API}/admin/cohorts` : `${API}/admin/cohorts/${cohort.id}`
    const method = isNew ? 'POST' : 'PATCH'
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.detail || `HTTP ${res.status}`); setBusy(false); return }
      onSave()
    } catch (ex) { setErr(ex.message); setBusy(false) }
  }

  const inp = { ...S.inp, marginBottom: 12 }
  const lbl = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6E6E73',
    marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }
  const sel = { ...inp, cursor: 'pointer' }
  const half = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 18, padding: '28px 28px 24px',
        maxWidth: 620, width: '100%', maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(0,0,0,0.3)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{isNew ? 'Add cohort' : 'Edit cohort'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22,
            cursor: 'pointer', color: '#9ca3af', lineHeight: 1 }}>×</button>
        </div>

        {err && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9,
            padding: '10px 14px', color: '#991b1b', fontSize: 13, marginBottom: 16 }}>{err}</div>
        )}

        <form onSubmit={submit}>
          {/* Identity */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10 }}>Identity</div>
          <label style={lbl}>Cohort name *</label>
          <input style={inp} required value={form.name} onChange={e => set('name', e.target.value)} placeholder="UK Glaucoma Longitudinal Cohort" />
          <div style={half}>
            <div>
              <label style={lbl}>Slug *</label>
              <input style={inp} required value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="uk-glaucoma-longitudinal" />
            </div>
            <div>
              <label style={lbl}>Contributing institution *</label>
              <input style={inp} required value={form.contributing_institution} onChange={e => set('contributing_institution', e.target.value)} placeholder="Moorfields Eye Hospital" />
            </div>
          </div>
          <label style={lbl}>Description</label>
          <textarea style={{ ...inp, resize: 'vertical', marginBottom: 16 }} rows={3}
            value={form.description || ''} onChange={e => set('description', e.target.value)}
            placeholder="Brief description of the cohort..." />

          {/* Classification */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10 }}>Classification</div>
          <div style={half}>
            <div>
              <label style={lbl}>Modality *</label>
              <select style={sel} value={form.modality} onChange={e => set('modality', e.target.value)}>
                {MODALITY_OPTS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Disease area *</label>
              <input style={inp} required value={form.disease_area} onChange={e => set('disease_area', e.target.value)} placeholder="Glaucoma" />
            </div>
          </div>

          {/* Size */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10 }}>Size</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {[['sample_count','Participants','1847'],['age_range_min','Age min','18'],['age_range_max','Age max','90']].map(([k,label,ph]) => (
              <div key={k}>
                <label style={lbl}>{label}</label>
                <input style={inp} type="number" min={0} value={form[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} />
              </div>
            ))}
          </div>

          {/* Technical */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10 }}>Technical</div>
          <div style={half}>
            <div>
              <label style={lbl}>Data format</label>
              <select style={sel} value={form.data_format} onChange={e => set('data_format', e.target.value)}>
                {FORMAT_OPTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Imaging device</label>
              <input style={inp} value={form.imaging_device || ''} onChange={e => set('imaging_device', e.target.value)} placeholder="Heidelberg Spectralis" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.longitudinal} onChange={e => set('longitudinal', e.target.checked)} />
              Longitudinal
            </label>
            {form.longitudinal && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...lbl, margin: 0 }}>Follow-up years</label>
                <input style={{ ...inp, width: 80, marginBottom: 0 }} type="number" step="0.1" min={0}
                  value={form.follow_up_years || ''} onChange={e => set('follow_up_years', e.target.value)} placeholder="3.5" />
              </div>
            )}
          </div>

          {/* Governance */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10 }}>Governance</div>
          <div style={half}>
            <div>
              <label style={lbl}>Access type</label>
              <select style={sel} value={form.access_type} onChange={e => set('access_type', e.target.value)}>
                {ACCESS_OPTS.map(a => <option key={a} value={a}>{a.replace(/_/g,' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Consent basis</label>
              <select style={sel} value={form.consent_basis} onChange={e => set('consent_basis', e.target.value)}>
                {CONSENT_OPTS.map(c => <option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
              </select>
            </div>
          </div>
          <div style={half}>
            <div>
              <label style={lbl}>Ethics reference</label>
              <input style={inp} value={form.ethics_reference || ''} onChange={e => set('ethics_reference', e.target.value)} placeholder="REC-22/LO/1847" />
            </div>
            <div>
              <label style={lbl}>DOI</label>
              <input style={inp} value={form.doi || ''} onChange={e => set('doi', e.target.value)} placeholder="10.1038/..." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            {[['dspt_compliant','DSPT compliant'],['ico_registered','ICO registered'],['featured','Featured']].map(([k,label]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>

          {/* Catalogue status */}
          <div style={half}>
            <div>
              <label style={lbl}>Status</label>
              <select style={sel} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <button type="submit" disabled={busy} style={{ width: '100%', padding: '12px 0',
            background: busy ? 'rgba(0,122,255,0.5)' : '#007AFF', color: '#fff', border: 'none',
            borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: busy ? 'not-allowed' : 'pointer',
            marginTop: 8 }}>
            {busy ? 'Saving…' : isNew ? 'Create cohort' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  )
}

function CohortAdmin({ session }) {
  const [cohorts, setCohorts] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg,     setMsg]     = useState(null)
  const [editing, setEditing] = useState(null)
  const [adding,  setAdding]  = useState(false)
  const [busy,    setBusy]    = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/admin/cohorts`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) setCohorts(await res.json())
    } catch (_) {}
    setLoading(false)
  }, [session])

  useEffect(() => { load() }, [load])

  const flash = m => { setMsg(m); setTimeout(() => setMsg(null), 3500) }

  const patch = async (id, fields) => {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await fetch(`${API}/admin/cohorts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(fields),
      })
      await load()
      flash('Updated.')
    } catch (_) { flash('Update failed.') }
    setBusy(b => ({ ...b, [id]: false }))
  }

  const archive = async id => {
    if (!window.confirm('Archive this cohort? It will be hidden from the public catalogue.')) return
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await fetch(`${API}/admin/cohorts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } })
      await load(); flash('Archived.')
    } catch (_) { flash('Archive failed.') }
    setBusy(b => ({ ...b, [id]: false }))
  }

  const counts = {
    published: cohorts.filter(c => c.status === 'published').length,
    pending:   cohorts.filter(c => c.status === 'pending').length,
    archived:  cohorts.filter(c => c.status === 'archived').length,
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1D1D1F' }}>Data Catalogue — Cohort Management</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
            {counts.published} published · {counts.pending} pending · {counts.archived} archived
          </div>
        </div>
        <button onClick={() => setAdding(true)} style={{ ...btn('#007AFF'), padding: '9px 18px', fontSize: 13 }}>
          + Add cohort
        </button>
      </div>

      {msg && (
        <div style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 9,
          padding: '10px 16px', color: '#065f46', fontSize: 13, marginBottom: 16 }}>{msg}</div>
      )}

      {loading && <div style={{ color: '#9ca3af', fontSize: 13, padding: '20px 0' }}>Loading cohorts…</div>}

      {!loading && (
        <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14,
          overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Cohort','Modality','Participants','Access','Status','Featured','Actions'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map(c => {
                const sc = STATUS_COLORS[c.status] || STATUS_COLORS.archived
                return (
                  <tr key={c.id}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#1D1D1F', marginBottom: 1 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{c.contributing_institution}</div>
                    </td>
                    <td style={S.td}>
                      <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                        borderRadius: 99, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>
                        {c.modality}
                      </span>
                    </td>
                    <td style={S.td}>{c.sample_count ? c.sample_count.toLocaleString() : '—'}</td>
                    <td style={S.td}>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{(c.access_type || '').replace(/_/g,' ')}</span>
                    </td>
                    <td style={S.td}>
                      <select
                        value={c.status}
                        disabled={!!busy[c.id]}
                        onChange={e => patch(c.id, { status: e.target.value })}
                        style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                          borderRadius: 99, padding: '3px 10px', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', outline: 'none' }}>
                        {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <button
                        onClick={() => patch(c.id, { featured: !c.featured })}
                        disabled={!!busy[c.id]}
                        style={{ background: 'none', border: 'none', fontSize: 18,
                          cursor: 'pointer', opacity: busy[c.id] ? 0.4 : 1 }}
                        title={c.featured ? 'Unfeature' : 'Feature'}>
                        {c.featured ? '★' : '☆'}
                      </button>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditing(c)}
                          style={{ ...btn('rgba(0,122,255,0.08)', '#007AFF', true), padding: '5px 12px', fontSize: 12 }}>
                          Edit
                        </button>
                        {c.status !== 'archived' && (
                          <button onClick={() => archive(c.id)} disabled={!!busy[c.id]}
                            style={{ ...btn('rgba(220,38,38,0.06)', '#dc2626', true), padding: '5px 12px', fontSize: 12 }}>
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {cohorts.length === 0 && (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: '32px 0' }}>
                  No cohorts yet. Click "Add cohort" to create the first one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <CohortFormModal
          cohort={editing}
          session={session}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSave={async () => { setAdding(false); setEditing(null); await load(); flash('Saved.') }}
        />
      )}
    </div>
  )
}


export default function AdminDashboard({ session }) {
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const [requests, setRequests] = useState([])
  const [studies, setStudies] = useState([])
  const [studiesLoading, setStudiesLoading] = useState(true)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/stats`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) setStats(await res.json())
    } catch (_) {}
  }, [session])

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/access-requests`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) setRequests(await res.json())
    } catch (_) {}
  }, [session])

  const fetchStudies = useCallback(async () => {
    setStudiesLoading(true)
    try {
      const res = await fetch(`${API}/admin/studies`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) setStudies(await res.json())
    } catch (_) {}
    finally { setStudiesLoading(false) }
  }, [session])

  useEffect(() => {
    fetchStats()
    fetchRequests()
    fetchStudies()
    const id = setInterval(fetchStats, 15000)
    return () => clearInterval(id)
  }, [fetchStats, fetchRequests, fetchStudies])

  const pendingCount = requests.filter(r => r.status === 'pending').length

  const navTab = (id, label, badge) => (
    <button
      onClick={() => setTab(id)}
      style={{ padding: '6px 16px', borderRadius: 99, fontSize: 13, fontWeight: tab === id ? 600 : 500, cursor: 'pointer', border: 'none', background: tab === id ? '#007AFF' : 'rgba(0,0,0,0.05)', color: tab === id ? '#fff' : '#6E6E73', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}
    >
      {label}
      {badge > 0 && <span style={{ background: tab === id ? 'rgba(255,255,255,0.25)' : '#FF3B30', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>{badge}</span>}
    </button>
  )

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em', color: '#1D1D1F' }}>Admin Dashboard</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#6E6E73' }}>Platform management · UndosaTech Federated Research</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
        {navTab('overview', '📊 Overview', 0)}
        {navTab('requests', '📋 Access Requests', pendingCount)}
        {navTab('cohorts', '🗂 Cohorts', 0)}
        {navTab('studies', `🔬 All Studies`, 0)}
        {navTab('users', '👥 Users', 0)}
        {navTab('health', '🟢 Node Health', 0)}
        {navTab('hardware', '⚙️ Hardware', 0)}
        {navTab('metrics', '📈 Metrics', 0)}
      </div>

      {tab === 'overview' && (
        <Overview
          stats={stats}
          requests={requests}
          studies={studies}
          onTabSwitch={setTab}
        />
      )}

      {tab === 'requests' && (
        <AccessRequests
          session={session}
          onStatsRefresh={() => { fetchStats(); fetchRequests() }}
        />
      )}

      {tab === 'cohorts' && <CohortAdmin session={session} />}

      {tab === 'studies' && (
        <AllStudies studies={studies} loading={studiesLoading} />
      )}

      {tab === 'users' && <Users session={session} />}
      {tab === 'health' && <NodeHealth session={session} />}
      {tab === 'hardware' && <HardwareStatus session={session} />}
      {tab === 'metrics' && <ObservabilityPanel session={session} />}
    </div>
  )
}
