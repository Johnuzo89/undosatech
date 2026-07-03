import { useState, useEffect, useCallback } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app'
const card = { background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 16 }

export default function AnalyticsConsole({ session }) {
  const [tables, setTables] = useState([])
  const [sql, setSql] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const headers = { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }

  const loadTables = useCallback(async () => {
    try {
      const r = await fetch(`${API}/analytics/tables`, { headers })
      if (r.ok) {
        const d = await r.json()
        setTables(d.tables || [])
        if (!sql && d.tables?.length) setSql(`SELECT * FROM ${d.tables[0].table} LIMIT 20`)
      }
    } catch (_) {}
  }, [session])

  useEffect(() => { loadTables() }, [loadTables])

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await fetch(`${API}/analytics/query`, { method: 'POST', headers, body: JSON.stringify({ sql }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Query failed')
      setResult(d)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#1D1D1F', marginBottom: 4 }}>SQL Analytics</h1>
      <p style={{ fontSize: 13, color: '#6E6E73', marginBottom: 20 }}>
        Ad-hoc read-only SQL over uploaded datasets (DuckDB) — outputs pass NHS small-number suppression before release
      </p>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Available datasets</div>
        {tables.length === 0
          ? <div style={{ fontSize: 13, color: '#6E6E73' }}>No CSV datasets uploaded yet. Upload a CSV via Launch or Connectors first.</div>
          : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tables.map(t => (
                <button key={t.table} onClick={() => setSql(`SELECT * FROM ${t.table} LIMIT 20`)}
                  title={t.columns.map(c => `${c.name} ${c.type}`).join('\n')}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,122,255,0.3)', background: 'rgba(0,122,255,0.06)', color: '#007AFF', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'ui-monospace,monospace' }}>
                  {t.table} <span style={{ fontWeight: 400, color: '#6E6E73' }}>({t.rows} rows · {t.source})</span>
                </button>
              ))}
            </div>
          )}
      </div>

      <div style={card}>
        <textarea value={sql} onChange={e => setSql(e.target.value)} rows={5} spellCheck={false}
          placeholder="SELECT diagnosis, COUNT(*) AS patient_count FROM ds_xxx GROUP BY 1"
          style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontFamily: 'ui-monospace,SFMono-Regular,monospace', resize: 'vertical', background: '#FAFAFA' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#6E6E73' }}>SELECT only · 1000-row cap · every query is audit-logged</div>
          <button onClick={run} disabled={busy || !sql.trim()}
            style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#007AFF', color: '#fff', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Running…' : '▶ Run query'}
          </button>
        </div>
      </div>

      {error && <div style={{ ...card, background: 'rgba(255,59,48,0.07)', color: '#C4281C', fontSize: 13 }}>{error}</div>}

      {result && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {result.row_count} row{result.row_count !== 1 ? 's' : ''}{result.truncated ? ' (truncated at 1000)' : ''}
            </div>
            {result.sdc?.suppressed_cells > 0 && (
              <div style={{ fontSize: 12, background: 'rgba(255,159,10,0.12)', color: '#B25000', padding: '4px 10px', borderRadius: 8, fontWeight: 600 }}>
                🛡 {result.sdc.suppressed_cells} small cell{result.sdc.suppressed_cells > 1 ? 's' : ''} suppressed (n&lt;{result.sdc.min_cell_count})
              </div>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>{result.columns.map(c => (
                  <th key={c} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid rgba(0,0,0,0.08)', color: '#6E6E73', fontWeight: 600, whiteSpace: 'nowrap' }}>{c}</th>
                ))}</tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j} style={{ padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)', fontFamily: typeof v === 'number' ? 'ui-monospace,monospace' : 'inherit', color: v === '<suppressed>' ? '#B25000' : '#1D1D1F', fontStyle: v === '<suppressed>' ? 'italic' : 'normal' }}>
                        {v === null ? <span style={{ color: '#C7C7CC' }}>null</span> : String(v)}
                      </td>
                    ))}
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
