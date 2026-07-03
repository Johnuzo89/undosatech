import { useState, useEffect, useCallback } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app'
const card = { background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }

function Stat({ label, value, accent = '#1D1D1F', sub }) {
  return (
    <div style={{ ...card, flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 12, color: '#6E6E73', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent, marginTop: 4 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Bar({ pct, color }) {
  return (
    <div style={{ height: 6, borderRadius: 99, background: 'rgba(0,0,0,0.06)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, pct || 0)}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.4s' }} />
    </div>
  )
}

export default function ObservabilityPanel({ session }) {
  const [m, setM] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/admin/metrics`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setM(await r.json()); setError(null)
    } catch (e) { setError(e.message) }
  }, [session])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  if (error) return <div style={{ ...card, color: '#C4281C', fontSize: 13 }}>Metrics unavailable: {error}</div>
  if (!m) return <div style={{ fontSize: 13, color: '#6E6E73' }}>Loading metrics…</div>

  const up = m.uptime_seconds
  const uptime = up > 86400 ? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h`
    : up > 3600 ? `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m` : `${Math.floor(up / 60)}m`
  const lat = m.requests?.latency_ms || {}
  const sys = m.system || {}
  const chainOk = m.audit_chain?.valid

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Uptime" value={uptime} />
        <Stat label="Requests (1h)" value={m.requests?.last_hour} sub={`${m.requests?.total_since_boot} since boot`} />
        <Stat label="5xx errors (1h)" value={m.requests?.errors_5xx_last_hour}
          accent={m.requests?.errors_5xx_last_hour > 0 ? '#FF3B30' : '#32D74B'}
          sub={`${m.requests?.errors_5xx_total} total · ${m.requests?.errors_4xx_total} 4xx`} />
        <Stat label="p95 latency" value={lat.p95 != null ? `${lat.p95}ms` : '—'} sub={`p50 ${lat.p50 ?? '—'}ms · p99 ${lat.p99 ?? '—'}ms`} />
        <Stat label="Audit chain" value={chainOk === true ? '✓ intact' : chainOk === false ? '✗ BROKEN' : '—'}
          accent={chainOk === false ? '#FF3B30' : '#32D74B'} sub={`${m.audit_chain?.events ?? 0} events verified`} />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Studies" value={m.studies?.total} sub={`${m.studies?.running || 0} running · ${m.studies?.completed || 0} completed · ${m.studies?.failed || 0} failed`} />
        <Stat label="Nodes" value={m.nodes?.total ?? 0} sub={`${m.nodes?.active || 0} active · ${m.nodes?.pending || 0} pending`} />
        <div style={{ ...card, flex: '2 1 280px' }}>
          <div style={{ fontSize: 12, color: '#6E6E73', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>System</div>
          {[['CPU', sys.cpu_percent, '#007AFF'], ['Memory', sys.memory_percent, '#5856D6'], ['Disk', sys.disk_percent, '#FF9F0A']].map(([l, v, c]) => (
            <div key={l} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: '#3A3A3C', fontWeight: 500 }}>{l}</span>
                <span style={{ color: '#6E6E73' }}>{v != null ? `${v}%` : '—'}</span>
              </div>
              <Bar pct={v} color={c} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: '1 1 300px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Top endpoints (last hour)</div>
          {(m.requests?.top_endpoints || []).length === 0
            ? <div style={{ fontSize: 12.5, color: '#9ca3af' }}>No traffic yet</div>
            : (m.requests.top_endpoints.map(e => (
              <div key={e.path} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <code style={{ color: '#3A3A3C' }}>{e.path}</code>
                <span style={{ fontWeight: 600, color: '#007AFF' }}>{e.count}</span>
              </div>
            )))}
        </div>
        <div style={{ ...card, flex: '1 1 300px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recent server errors</div>
          {(m.recent_errors || []).length === 0
            ? <div style={{ fontSize: 12.5, color: '#32D74B', fontWeight: 500 }}>✓ No recent 5xx errors</div>
            : (m.recent_errors.slice().reverse().map((e, i) => (
              <div key={i} style={{ fontSize: 12, padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.04)', color: '#C4281C' }}>
                <span style={{ fontWeight: 700 }}>{e.status}</span> {e.method} <code>{e.path}</code>
                <span style={{ color: '#9ca3af', marginLeft: 6 }}>{new Date(e.at).toLocaleTimeString()}</span>
              </div>
            )))}
        </div>
      </div>
    </div>
  )
}
