import React, { useState, useEffect, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app'

const MODALITY_COLORS = {
  OCT:            ['#eff6ff', '#1d4ed8', '#bfdbfe'],
  fundus:         ['#f0fdf4', '#15803d', '#bbf7d0'],
  MRI:            ['#fdf4ff', '#7e22ce', '#e9d5ff'],
  CT:             ['#fff7ed', '#c2410c', '#fed7aa'],
  EEG:            ['#fefce8', '#a16207', '#fef08a'],
  histopathology: ['#fdf2f8', '#be185d', '#fbcfe8'],
  mixed:          ['#f8fafc', '#475569', '#e2e8f0'],
}

function ModalityBadge({ modality }) {
  const [bg, text, border] = MODALITY_COLORS[modality] || MODALITY_COLORS.mixed
  return (
    <span style={{ background: bg, color: text, border: `1px solid ${border}`,
      padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      letterSpacing: '0.03em' }}>
      {modality}
    </span>
  )
}

function PreviewTable({ rows, columns }) {
  if (!rows?.length) return null

  const numericCols = columns.filter(c =>
    typeof rows[0][c] === 'number' || (rows[0][c] !== undefined && !isNaN(+rows[0][c]) && rows[0][c] !== true && rows[0][c] !== false && rows[0][c] !== '')
  )
  const visibleCols = [
    'patient_id', 'age', 'sex', 'primary_diagnosis',
    ...numericCols.filter(c => !['age'].includes(c)).slice(0, 6),
    'visit_date',
  ].filter(c => columns.includes(c))

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {visibleCols.map(c => (
              <th key={c} style={{ padding: '8px 12px', background: '#F5F5F7', fontSize: 10,
                fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase',
                letterSpacing: '0.05em', textAlign: 'left', whiteSpace: 'nowrap',
                borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                {c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
              {visibleCols.map(c => (
                <td key={c} style={{ padding: '7px 12px', color: '#374151',
                  borderBottom: '1px solid rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>
                  {row[c] === true ? 'Yes' : row[c] === false ? 'No' : row[c] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SyntheticDataGenerator({ session }) {
  const [cohorts,   setCohorts]   = useState([])
  const [selected,  setSelected]  = useState(null)
  const [n,         setN]         = useState(200)
  const [dpEnabled, setDpEnabled] = useState(false)
  const [epsilon,   setEpsilon]   = useState(1.0)
  const [preview,   setPreview]   = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    supabase.from('cohorts').select('id,name,slug,modality,disease_area,contributing_institution,sample_count,age_range_min,age_range_max,sex_distribution,data_format,imaging_device,longitudinal,follow_up_years')
      .eq('status', 'published')
      .order('featured', { ascending: false })
      .order('sample_count', { ascending: false })
      .then(({ data }) => {
        setCohorts(data || [])
        if (data?.length) setSelected(data[0])
      })
  }, [])

  const generate = async () => {
    if (!selected) return
    setLoading(true); setError(null); setPreview(null)
    try {
      const res = await fetch(`${API}/synthetic/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cohort:     selected,
          n,
          dp_epsilon: dpEnabled ? epsilon : null,
          format:     'preview',
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${res.status}`) }
      setPreview(await res.json())
    } catch (ex) { setError(ex.message) }
    setLoading(false)
  }

  const download = async () => {
    if (!selected) return
    setDownloading(true)
    try {
      const res = await fetch(`${API}/synthetic/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cohort:     selected,
          n,
          dp_epsilon: dpEnabled ? epsilon : null,
          format:     'csv',
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const dp   = dpEnabled ? `_dp${epsilon}` : ''
      a.href     = url
      a.download = `synthetic_${selected.slug}${dp}_n${n}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (ex) { setError(ex.message) }
    setDownloading(false)
  }

  const inp = {
    padding: '9px 13px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 9,
    fontSize: 13, outline: 'none', fontFamily: 'inherit', background: 'rgba(0,0,0,0.03)',
    color: '#1D1D1F', boxSizing: 'border-box',
  }

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#1D1D1F', margin: 0 }}>
            Synthetic Data Generator
          </h1>
          <span style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe',
            borderRadius: 99, padding: '3px 12px', fontSize: 11, fontWeight: 700 }}>
            OMOP CDM
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#6E6E73', margin: 0, lineHeight: 1.5 }}>
          Generate statistically realistic synthetic patient records from cohort metadata.
          No real patient data used. Suitable for sandbox FL training, demos, and researcher preview.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>

        {/* Left: config panel */}
        <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14,
          padding: '20px 20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>

          {/* Cohort selector */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 10 }}>Source cohort</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cohorts.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setSelected(c); setPreview(null) }}
                  style={{
                    padding: '9px 12px', borderRadius: 9, fontSize: 12, textAlign: 'left',
                    cursor: 'pointer', border: selected?.id === c.id ? '2px solid #007AFF' : '1px solid rgba(0,0,0,0.08)',
                    background: selected?.id === c.id ? 'rgba(0,122,255,0.05)' : '#fafafa',
                    color: '#1D1D1F', transition: 'all 0.1s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <ModalityBadge modality={c.modality} />
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: 1, lineHeight: 1.3 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {c.disease_area} · {c.sample_count?.toLocaleString() || '—'} pts
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* N patients */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8 }}>Records to generate</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min={50} max={5000} step={50} value={n}
                onChange={e => setN(+e.target.value)}
                style={{ flex: 1, accentColor: '#007AFF' }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1D1D1F',
                minWidth: 44, textAlign: 'right' }}>{n.toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Max 5,000 per request
            </div>
          </div>

          {/* DP toggle */}
          <div style={{ marginBottom: 20, padding: '14px 14px', background: dpEnabled ? 'rgba(124,58,237,0.05)' : '#fafafa',
            border: `1px solid ${dpEnabled ? 'rgba(124,58,237,0.2)' : 'rgba(0,0,0,0.07)'}`,
            borderRadius: 10, transition: 'all 0.15s' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', marginBottom: dpEnabled ? 12 : 0 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dpEnabled ? '#7c3aed' : '#374151' }}>
                  Differential Privacy noise
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
                  Laplace noise on clinical fields
                </div>
              </div>
              <input type="checkbox" checked={dpEnabled} onChange={e => setDpEnabled(e.target.checked)}
                style={{ accentColor: '#7c3aed', width: 16, height: 16 }} />
            </label>

            {dpEnabled && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  Privacy budget ε (epsilon)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="range" min={0.1} max={10} step={0.1} value={epsilon}
                    onChange={e => setEpsilon(+e.target.value)}
                    style={{ flex: 1, accentColor: '#7c3aed' }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed',
                    minWidth: 36, textAlign: 'right' }}>ε={epsilon}</span>
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.5 }}>
                  {epsilon <= 1 ? 'Strong privacy (high noise)' : epsilon <= 3 ? 'Moderate privacy' : 'Weak privacy (low noise)'}
                  {' · '}δ=10⁻⁵ · Sensitivity=1
                </div>
              </div>
            )}
          </div>

          {/* Generate button */}
          <button onClick={generate} disabled={loading || !selected}
            style={{ width: '100%', padding: '11px 0', background: loading ? 'rgba(0,122,255,0.5)' : '#007AFF',
              color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14,
              cursor: loading || !selected ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : '0 2px 8px rgba(0,122,255,0.3)',
              marginBottom: 8 }}>
            {loading ? 'Generating…' : 'Generate preview'}
          </button>

          {preview && (
            <button onClick={download} disabled={downloading}
              style={{ width: '100%', padding: '10px 0',
                background: downloading ? 'rgba(5,150,105,0.4)' : 'rgba(5,150,105,0.08)',
                color: '#059669', border: '1px solid rgba(5,150,105,0.25)',
                borderRadius: 10, fontWeight: 600, fontSize: 13,
                cursor: downloading ? 'not-allowed' : 'pointer' }}>
              {downloading ? 'Preparing CSV…' : `⬇ Download CSV (${n.toLocaleString()} rows)`}
            </button>
          )}
        </div>

        {/* Right: output panel */}
        <div>
          {/* Selected cohort info card */}
          {selected && (
            <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14,
              padding: '16px 20px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    <ModalityBadge modality={selected.modality} />
                    {dpEnabled && (
                      <span style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe',
                        borderRadius: 99, padding: '2px 9px', fontSize: 11, fontWeight: 600 }}>
                        DP ε={epsilon}
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#1D1D1F', marginBottom: 3 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: '#6E6E73' }}>
                    🏥 {selected.contributing_institution} · {selected.disease_area}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', flexShrink: 0 }}>
                  {[
                    ['Real cohort size', selected.sample_count?.toLocaleString() || '—'],
                    ['Age range', selected.age_range_min && selected.age_range_max ? `${selected.age_range_min}–${selected.age_range_max}` : '—'],
                    ['Generating', n.toLocaleString() + ' records'],
                    ['Format', 'CSV / OMOP CDM'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
              padding: '14px 18px', color: '#991b1b', fontSize: 13, marginBottom: 16 }}>
              <strong>Generation failed:</strong> {error}
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14,
              padding: '18px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1D1D1F', marginBottom: 2 }}>
                    Preview — first 10 of {preview.total.toLocaleString()} records
                  </div>
                  <div style={{ fontSize: 12, color: '#6E6E73' }}>
                    {preview.columns.length} columns · {preview.disease_area}
                    {preview.dp_enabled && (
                      <span style={{ color: '#7c3aed', marginLeft: 8, fontWeight: 600 }}>
                        · DP ε={preview.dp_epsilon} applied
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ background: '#f0fdf4', color: '#059669', border: '1px solid #a7f3d0',
                  borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>
                  Synthetic
                </span>
              </div>

              <PreviewTable rows={preview.preview} columns={preview.columns} />

              <div style={{ marginTop: 14, padding: '10px 14px', background: '#f8fafc',
                borderRadius: 8, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
                <strong>All {preview.columns.length} columns:</strong>{' '}
                <span style={{ color: '#9ca3af' }}>{preview.columns.join(' · ')}</span>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!preview && !loading && !error && (
            <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 14,
              padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>🧬</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1D1D1F', marginBottom: 6 }}>
                Configure and generate
              </div>
              <div style={{ fontSize: 13, color: '#6E6E73', lineHeight: 1.6, maxWidth: 380, margin: '0 auto' }}>
                Select a source cohort, set the record count, optionally enable DP noise,
                then click Generate preview to see the first 10 rows.
                Download the full dataset as a CSV for FL training or analysis.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer notice */}
      <div style={{ marginTop: 24, padding: '14px 18px',
        background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.12)',
        borderRadius: 12, fontSize: 12, color: '#374151', lineHeight: 1.7 }}>
        <strong style={{ color: '#7c3aed' }}>Synthetic data notice.</strong>{' '}
        All records are entirely computer-generated from cohort-level statistics.
        No real patient data is present. Clinical values are sampled from disease-appropriate
        distributions but do not represent any individual. Records are labelled{' '}
        <code style={{ background: '#f5f3ff', padding: '1px 5px', borderRadius: 4 }}>synthetic: true</code>{' '}
        in every row. Differential Privacy noise (if enabled) applies Laplace mechanism
        with the specified ε budget and δ=10⁻⁵.
      </div>
    </div>
  )
}
