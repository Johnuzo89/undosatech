// portal/src/components/AdminDashboard.jsx

import { useState, useEffect, useCallback } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app'

// ── Shared ────────────────────────────────────────────────────────────────────
const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', marginBottom: 14 },
  th:   { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', textAlign: 'left', whiteSpace: 'nowrap' },
  td:   { padding: '12px 14px', fontSize: 13, color: '#374151', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' },
  inp:  { padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
}

const btn = (bg, text = '#fff', small = false) => ({
  padding: small ? '5px 12px' : '9px 18px', borderRadius: 8, border: 'none',
  background: bg, color: text, fontWeight: 600, cursor: 'pointer',
  fontSize: small ? 12 : 13, whiteSpace: 'nowrap',
})

function StatusPill({ status }) {
  const map = {
    pending:   ['#fef3c7', '#92400e'],
    approved:  ['#d1fae5', '#065f46'],
    rejected:  ['#fee2e2', '#991b1b'],
    running:   ['#ede9fe', '#5b21b6'],
    completed: ['#d1fae5', '#065f46'],
    failed:    ['#fee2e2', '#991b1b'],
    cancelled: ['#f3f4f6', '#374151'],
    stopped:   ['#fef3c7', '#92400e'],
    active:    ['#d1fae5', '#065f46'],
    offline:   ['#f3f4f6', '#374151'],
    suspended: ['#fee2e2', '#991b1b'],
  }
  const [bg, c] = map[status] || ['#f3f4f6', '#374151']
  return <span style={{ background: bg, color: c, padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{status}</span>
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
function StatCard({ label, value, sub, color = '#111827', alert }) {
  return (
    <div style={{ ...S.card, marginBottom: 0, position: 'relative' }}>
      {alert > 0 && <span style={{ position: 'absolute', top: 14, right: 14, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99 }}>{alert}</span>}
      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── Reject reason modal ───────────────────────────────────────────────────────
function RejectModal({ request, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>Reject request</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
          Rejecting access for <strong>{request.email}</strong> ({request.institution}).
        </p>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Reason (optional, not emailed)</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Insufficient research justification"
          rows={3}
          style={{ ...S.inp, resize: 'vertical', marginBottom: 16 }}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ ...btn('#f3f4f6', '#374151'), flex: 1 }}>Cancel</button>
          <button onClick={() => onConfirm(reason)} style={{ ...btn('#dc2626'), flex: 1 }}>Confirm reject</button>
        </div>
      </div>
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function Overview({ stats, requests, studies, onTabSwitch }) {
  if (!stats) return <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>Loading stats…</div>
  const pendingReqs = requests.filter(r => r.status === 'pending')
  const recentStudies = studies.slice(0, 6)

  return (
    <div>
      {/* Stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        <StatCard label="Pending requests" value={stats.access_requests.pending} color={stats.access_requests.pending > 0 ? '#dc2626' : '#111'} alert={stats.access_requests.pending} sub={`${stats.access_requests.total} total`} />
        <StatCard label="Registered users" value={stats.users.total} color="#1d4ed8" sub="all time" />
        <StatCard label="Total studies" value={stats.studies.total} color="#111" sub={`${stats.studies.running} running`} />
        <StatCard label="Studies complete" value={stats.studies.completed} color="#059669" sub={`${stats.studies.failed} failed`} />
        <StatCard label="FL nodes" value={stats.nodes.total} color="#7c3aed" sub={`${stats.nodes.active} active · ${stats.nodes.pending} pending`} />
      </div>

      {/* Pending requests callout */}
      {pendingReqs.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 18px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#92400e' }}>⚠ {pendingReqs.length} access request{pendingReqs.length > 1 ? 's' : ''} awaiting review</div>
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>{pendingReqs.map(r => r.email).join(', ')}</div>
          </div>
          <button onClick={() => onTabSwitch('requests')} style={{ ...btn('#d97706'), padding: '7px 14px', fontSize: 12 }}>Review now →</button>
        </div>
      )}

      {/* Recent studies */}
      {recentStudies.length > 0 && (
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
            <span>Recent studies</span>
            <button onClick={() => onTabSwitch('studies')} style={{ ...btn('transparent', '#1d4ed8', true), padding: 0 }}>View all →</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Study', 'User', 'Dataset', 'Status', 'Accuracy', 'Created'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {recentStudies.map(s => (
                <tr key={s.id || s.study_id}>
                  <td style={S.td}><span style={{ fontWeight: 600 }}>{s.name || s.study_name}</span></td>
                  <td style={{ ...S.td, fontSize: 12, color: '#6b7280' }}>{s.user_email || '—'}</td>
                  <td style={S.td}>{s.dataset}</td>
                  <td style={S.td}><StatusPill status={s.status} /></td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#059669' }}>{s.final_accuracy != null ? `${(s.final_accuracy * 100).toFixed(1)}%` : '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#9ca3af' }}>{ago(s.created_at)}</td>
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
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none', background: filter === f ? '#1d4ed8' : '#f3f4f6', color: filter === f ? '#fff' : '#6b7280', fontWeight: filter === f ? 600 : 400, textTransform: 'capitalize' }}>{f}</button>
        ))}
        <button onClick={load} style={{ ...btn('#f3f4f6', '#6b7280', true), marginLeft: 'auto' }}>↻ Refresh</button>
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13,
        background: msg.type === 'success' ? '#d1fae5' : msg.type === 'warning' ? '#fef3c7' : '#fee2e2',
        color:      msg.type === 'success' ? '#065f46' : msg.type === 'warning' ? '#92400e' : '#991b1b' }}>{msg.text}</div>}

      {loading ? (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>No {filter} requests.</div>
      ) : (
        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', 'Email', 'Institution', 'Role', 'Research Area', 'Submitted', 'Status', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} style={{ background: r.status === 'pending' ? '#fffbeb' : '#fff' }}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{r.full_name || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.email}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.institution}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.role}</td>
                  <td style={{ ...S.td, fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.research_area || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#9ca3af' }}>{ago(r.created_at)}</td>
                  <td style={S.td}><StatusPill status={r.status} /></td>
                  <td style={S.td}>
                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => act(r.id, 'approve')}
                          disabled={!!busy[r.id]}
                          style={{ ...btn('#059669', '#fff', true) }}
                        >{busy[r.id] === 'approve' ? '…' : '✓ Approve'}</button>
                        <button
                          onClick={() => setRejectTarget(r)}
                          disabled={!!busy[r.id]}
                          style={{ ...btn('#fee2e2', '#991b1b', true) }}
                        >✗ Reject</button>
                      </div>
                    )}
                    {r.status === 'approved' && (
                      <button
                        onClick={() => act(r.id, 'resend')}
                        disabled={!!busy[r.id]}
                        style={{ ...btn('#eff6ff', '#1d4ed8', true) }}
                      >{busy[r.id] === 'resend' ? '…' : '✉ Resend'}</button>
                    )}
                    {r.status === 'rejected' && r.rejection_reason && (
                      <span style={{ fontSize: 11, color: '#9ca3af' }} title={r.rejection_reason}>Reason recorded</span>
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
            <button key={f} onClick={() => setFilterStatus(f)} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none', background: filterStatus === f ? '#1d4ed8' : '#f3f4f6', color: filterStatus === f ? '#fff' : '#6b7280', fontWeight: filterStatus === f ? 600 : 400, textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af', alignSelf: 'center' }}>{filtered.length} studies</span>
      </div>

      {loading ? (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>No studies found.</div>
      ) : (
        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Study', 'User', 'Model', 'Dataset', 'Rounds', 'Status', 'Accuracy', 'Created'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id || s.study_id} style={{ cursor: 'default' }}>
                  <td style={{ ...S.td, fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || s.study_name}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#6b7280' }}>{s.user_email || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{s.model || s.architecture || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{s.dataset}</td>
                  <td style={{ ...S.td, fontSize: 12, textAlign: 'center' }}>{s.current_round ?? 0}/{s.total_rounds || s.num_rounds}</td>
                  <td style={S.td}><StatusPill status={s.status} /></td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#059669' }}>{s.final_accuracy != null ? `${(s.final_accuracy * 100).toFixed(1)}%` : '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#9ca3af' }}>{ago(s.created_at)}</td>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 17, color: '#dc2626' }}>Delete account permanently?</h3>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: '#374151' }}>
          This will <strong>permanently delete</strong> the Supabase account for:
        </p>
        <p style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 600, color: '#111827' }}>{user.email}</p>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
          Their studies and data remain but they will not be able to log in. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ ...btn('#f3f4f6', '#374151'), flex: 1 }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btn('#dc2626'), flex: 1 }}>Delete permanently</button>
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
    setLoading(true)
    try {
      const res = await fetch(`${API}/admin/users`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      const d = await res.json()
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
        <button onClick={load} style={{ ...btn('#f3f4f6', '#6b7280', true) }}>↻ Refresh</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>{filtered.length} users</span>
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13,
        background: msg.type === 'success' ? '#d1fae5' : '#fee2e2',
        color:      msg.type === 'success' ? '#065f46' : '#991b1b' }}>{msg.text}</div>}

      {loading ? (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : (
        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', 'Email', 'Institution', 'Role', 'Type', 'Status', 'Joined', 'Last sign-in', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={{ background: u.banned ? '#fff7f7' : '#fff' }}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{u.full_name || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{u.email}</td>
                  <td style={{ ...S.td, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.institution || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{u.role || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>
                    <span style={{ background: u.account_type === 'approved' ? '#dbeafe' : '#f0fdf4', color: u.account_type === 'approved' ? '#1e40af' : '#166534', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>
                      {u.account_type || 'institutional'}
                    </span>
                  </td>
                  <td style={S.td}>
                    {u.banned
                      ? <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>banned</span>
                      : <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>active</span>
                    }
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: '#9ca3af' }}>{ago(u.created_at)}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#9ca3af' }}>{ago(u.last_sign_in_at)}</td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {u.banned ? (
                        <button
                          onClick={() => act(u.id, 'reactivate')}
                          disabled={!!busy[u.id]}
                          style={{ ...btn('#d1fae5', '#065f46', true) }}
                        >{busy[u.id] === 'reactivate' ? '…' : '✓ Reactivate'}</button>
                      ) : (
                        <button
                          onClick={() => act(u.id, 'deactivate')}
                          disabled={!!busy[u.id]}
                          style={{ ...btn('#fef3c7', '#92400e', true) }}
                        >{busy[u.id] === 'deactivate' ? '…' : '⊘ Deactivate'}</button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(u)}
                        disabled={!!busy[u.id]}
                        style={{ ...btn('#fee2e2', '#991b1b', true) }}
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

// ── Main AdminDashboard ───────────────────────────────────────────────────────
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
      style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: tab === id ? 600 : 400, cursor: 'pointer', border: 'none', background: tab === id ? '#1d4ed8' : '#f3f4f6', color: tab === id ? '#fff' : '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}
    >
      {label}
      {badge > 0 && <span style={{ background: '#dc2626', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>{badge}</span>}
    </button>
  )

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Admin Dashboard</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Platform management · UndosaTech Federated Research</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {navTab('overview', '📊 Overview', 0)}
        {navTab('requests', '📋 Access Requests', pendingCount)}
        {navTab('studies', `🔬 All Studies`, 0)}
        {navTab('users', '👥 Users', 0)}
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

      {tab === 'studies' && (
        <AllStudies studies={studies} loading={studiesLoading} />
      )}

      {tab === 'users' && <Users session={session} />}
    </div>
  )
}
