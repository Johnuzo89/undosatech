import React, { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app'

const QUERY_TYPES = [
  { id: 'mean',       label: 'Mean',        icon: '📊', desc: 'Average value of a numeric field' },
  { id: 'count',      label: 'Count',       icon: '🔢', desc: 'Total number of records (noisy)' },
  { id: 'proportion', label: 'Proportion',  icon: '🥧', desc: 'Fraction matching a category value' },
  { id: 'histogram',  label: 'Histogram',   icon: '📈', desc: 'Distribution across numeric bins' },
]

const BUDGET_TOTAL = 10.0   // default per-session epsilon budget

function epsilonLabel(e) {
  if (e <= 0.5) return { text: 'Very strong', color: '#059669' }
  if (e <= 1.5) return { text: 'Strong',      color: '#16a34a' }
  if (e <= 3)   return { text: 'Moderate',    color: '#d97706' }
  if (e <= 6)   return { text: 'Weak',        color: '#ea580c' }
  return               { text: 'Very weak',   color: '#dc2626' }
}

function BudgetMeter({ spent, total }) {
  const pct     = Math.min(spent / total, 1)
  const remain  = Math.max(0, total - spent)
  const color   = pct < 0.5 ? '#059669' : pct < 0.8 ? '#d97706' : '#dc2626'
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 12,
      padding: '14px 18px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Session Privacy Budget</div>
        <div style={{ fontSize: 12, fontWeight: 700, color }}>
          ε {remain.toFixed(2)} remaining / {total} total
        </div>
      </div>
      <div style={{ height: 8, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: color,
          borderRadius: 99, transition: 'width 0.4s' }} />
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6, lineHeight: 1.5 }}>
        Sequential composition — each query consumes its ε from this session budget.
        Budget resets on page reload.
      </div>
    </div>
  )
}

function BarChart({ labels, values, trueValues, color = '#7c3aed', showTrue = true }) {
  const max = Math.max(...values, ...(showTrue ? trueValues : []), 1)
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
        {values.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: 8, color: '#9ca3af', textAlign: 'center',
              overflow: 'hidden', width: '100%', lineHeight: 1 }}>
              {v}
            </div>
            <div style={{ position: 'relative', width: '100%', display: 'flex', gap: 1,
              alignItems: 'flex-end', height: '90%' }}>
              {showTrue && trueValues[i] !== undefined && (
                <div style={{ flex: 1, background: 'rgba(124,58,237,0.15)',
                  height: `${(trueValues[i] / max) * 100}%`, borderRadius: '3px 3px 0 0',
                  minHeight: 1, transition: 'height 0.4s' }} />
              )}
              <div style={{ flex: 1, background: color, opacity: 0.85,
                height: `${(Math.max(0, v) / max) * 100}%`, borderRadius: '3px 3px 0 0',
                minHeight: 1, transition: 'height 0.4s' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {labels.map((l, i) => (
          <div key={i} style={{ flex: 1, fontSize: 7, color: '#9ca3af',
            textAlign: 'center', lineHeight: 1.2, overflow: 'hidden' }}>
            {l}
          </div>
        ))}
      </div>
      {showTrue && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(124,58,237,0.3)' }} />
            True (for reference)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.85 }} />
            Noisy (released)
          </div>
        </div>
      )}
    </div>
  )
}

function ResultCard({ result, cohortName }) {
  const { query_type, field_label, epsilon, noisy_value, true_value, noise_scale,
    bin_labels, noisy_counts, true_counts, category_value, n_samples } = result

  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14,
      padding: '18px 20px', marginBottom: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1D1D1F', marginBottom: 3 }}>
            {QUERY_TYPES.find(q => q.id === query_type)?.icon} {query_type.charAt(0).toUpperCase() + query_type.slice(1)} of {field_label}
          </div>
          <div style={{ fontSize: 12, color: '#6E6E73' }}>{cohortName} · n={n_samples} synthetic records</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe',
            borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>
            ε={epsilon}
          </span>
          <span style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
            borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>
            σ={noise_scale}
          </span>
        </div>
      </div>

      {query_type === 'histogram' ? (
        <div>
          <BarChart
            labels={bin_labels}
            values={noisy_counts}
            trueValues={true_counts}
            color="#7c3aed"
          />
        </div>
      ) : query_type === 'proportion' ? (
        <div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#7c3aed' }}>
                {(noisy_value * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>Released (noisy)</div>
            </div>
            <div style={{ textAlign: 'center', opacity: 0.5 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#374151' }}>
                {(true_value * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>True (reference only)</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#6E6E73' }}>
            Proportion where <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>{field_label} = "{category_value}"</code>
          </div>
        </div>
      ) : query_type === 'count' ? (
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#7c3aed' }}>
              {Math.round(noisy_value).toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>Released (noisy)</div>
          </div>
          <div style={{ textAlign: 'center', opacity: 0.5 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#374151' }}>
              {Math.round(true_value).toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>True (reference only)</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#7c3aed' }}>{noisy_value}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>Released (noisy)</div>
          </div>
          <div style={{ textAlign: 'center', opacity: 0.5 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#374151' }}>{true_value}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>True (reference only)</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14, padding: '8px 12px', background: '#f8fafc', borderRadius: 8,
        fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
        Laplace mechanism · sensitivity={result.sensitivity ?? 1} · noise scale σ={noise_scale} · δ={result.delta}
        <br />
        The true value is shown for illustration only — in production it would not be disclosed.
      </div>
    </div>
  )
}

export default function DPQueryConsole({ session }) {
  const [cohorts,      setCohorts]      = useState([])
  const [selected,     setSelected]     = useState(null)
  const [fields,       setFields]       = useState({})
  const [queryType,    setQueryType]    = useState('mean')
  const [field,        setField]        = useState('')
  const [epsilon,      setEpsilon]      = useState(1.0)
  const [bins,         setBins]         = useState(10)
  const [catValue,     setCatValue]     = useState('')
  const [nSamples,     setNSamples]     = useState(500)
  const [results,      setResults]      = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [budgetSpent,  setBudgetSpent]  = useState(0)

  useEffect(() => {
    supabase.from('cohorts').select('id,name,slug,modality,disease_area,contributing_institution,sample_count,age_range_min,age_range_max,sex_distribution,data_format,imaging_device,longitudinal,follow_up_years')
      .eq('status', 'published').order('featured', { ascending: false })
      .then(({ data }) => { setCohorts(data || []); if (data?.length) setSelected(data[0]) })
  }, [])

  useEffect(() => {
    if (!selected) return
    fetch(`${API}/dp/fields/${encodeURIComponent(selected.disease_area)}`)
      .then(r => r.json())
      .then(f => {
        setFields(f)
        const numericField = Object.entries(f).find(([, v]) => v.type === 'numeric')?.[0] || ''
        setField(numericField)
        setCatValue('')
      })
      .catch(() => {})
  }, [selected])

  const fieldMeta     = fields[field] || {}
  const isCategorical = fieldMeta.type === 'categorical'
  const needsCat      = queryType === 'proportion'
  const needsBins     = queryType === 'histogram'
  const budgetLeft    = BUDGET_TOTAL - budgetSpent
  const overBudget    = epsilon > budgetLeft
  const epLabel       = epsilonLabel(epsilon)

  const runQuery = async () => {
    if (!selected || !field || overBudget) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/dp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cohort:         selected,
          query_type:     queryType,
          field,
          epsilon,
          n_samples:      nSamples,
          bins,
          category_value: needsCat && catValue ? catValue : undefined,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${res.status}`) }
      const data = await res.json()
      setResults(prev => [{ ...data, cohortName: selected.name, ts: Date.now() }, ...prev])
      setBudgetSpent(prev => +(prev + epsilon).toFixed(4))
    } catch (ex) { setError(ex.message) }
    setLoading(false)
  }

  const numericFields     = Object.entries(fields).filter(([, v]) => v.type === 'numeric')
  const categoricalFields = Object.entries(fields).filter(([, v]) => v.type === 'categorical')
  const availableFields   = (isCategorical || needsCat)
    ? (queryType === 'mean' || queryType === 'histogram' ? numericFields : [...numericFields, ...categoricalFields])
    : (queryType === 'mean' || queryType === 'histogram' ? numericFields : [...numericFields, ...categoricalFields])

  const inp = {
    padding: '9px 13px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 9,
    fontSize: 13, outline: 'none', fontFamily: 'inherit', background: 'rgba(0,0,0,0.03)',
    color: '#1D1D1F', boxSizing: 'border-box', width: '100%',
  }

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#1D1D1F', margin: 0 }}>
            DP Query Console
          </h1>
          <span style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe',
            borderRadius: 99, padding: '3px 12px', fontSize: 11, fontWeight: 700 }}>
            Laplace Mechanism
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#6E6E73', margin: 0, lineHeight: 1.5 }}>
          Run differentially private aggregate queries over cohort data.
          Each query consumes epsilon from your session budget. True values are shown for illustration only.
        </p>
      </div>

      <BudgetMeter spent={budgetSpent} total={BUDGET_TOTAL} />

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>

        {/* Left: query builder */}
        <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14,
          padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>

          {/* Cohort */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8 }}>Cohort</div>
            <select style={inp} value={selected?.id || ''} onChange={e => {
              const c = cohorts.find(c => c.id === e.target.value)
              setSelected(c); setResults([])
            }}>
              {cohorts.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Query type */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8 }}>Query type</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {QUERY_TYPES.map(qt => (
                <button key={qt.id} onClick={() => { setQueryType(qt.id); setField('') }}
                  title={qt.desc}
                  style={{ padding: '8px 6px', borderRadius: 9, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', border: queryType === qt.id ? '2px solid #7c3aed' : '1px solid rgba(0,0,0,0.1)',
                    background: queryType === qt.id ? 'rgba(124,58,237,0.07)' : '#fafafa',
                    color: queryType === qt.id ? '#7c3aed' : '#374151' }}>
                  {qt.icon} {qt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Field */}
          {queryType !== 'count' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
                letterSpacing: '0.08em', marginBottom: 8 }}>Field</div>
              <select style={inp} value={field} onChange={e => { setField(e.target.value); setCatValue('') }}>
                {numericFields.length > 0 && (queryType === 'mean' || queryType === 'histogram') && (
                  numericFields.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)
                )}
                {(queryType === 'proportion') && (
                  [...numericFields, ...categoricalFields].map(([k, v]) => <option key={k} value={k}>{v.label}</option>)
                )}
              </select>
            </div>
          )}

          {/* Category value for proportion */}
          {needsCat && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
                letterSpacing: '0.08em', marginBottom: 8 }}>Category value</div>
              <input style={inp} value={catValue} onChange={e => setCatValue(e.target.value)}
                placeholder={field === 'sex' ? 'e.g. M or F' : 'e.g. wet_AMD'} />
            </div>
          )}

          {/* Bins for histogram */}
          {needsBins && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
                letterSpacing: '0.08em', marginBottom: 8 }}>Bins — {bins}</div>
              <input type="range" min={4} max={20} value={bins} onChange={e => setBins(+e.target.value)}
                style={{ width: '100%', accentColor: '#7c3aed' }} />
            </div>
          )}

          {/* Epsilon */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8 }}>
              Privacy budget ε (epsilon)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <input type="range" min={0.1} max={Math.max(0.1, budgetLeft)} step={0.1}
                value={epsilon} onChange={e => setEpsilon(+e.target.value)}
                style={{ flex: 1, accentColor: '#7c3aed' }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', minWidth: 40, textAlign: 'right' }}>
                ε={epsilon}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: epLabel.color }}>{epLabel.text}</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>
                {overBudget ? '⚠ Exceeds budget' : `Cost: ε=${epsilon}`}
              </span>
            </div>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
              padding: '8px 12px', color: '#991b1b', fontSize: 12, marginBottom: 12 }}>{error}</div>
          )}

          <button onClick={runQuery} disabled={loading || overBudget || !selected || (queryType !== 'count' && !field)}
            style={{ width: '100%', padding: '11px 0',
              background: (loading || overBudget) ? 'rgba(124,58,237,0.3)' : '#7c3aed',
              color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14,
              cursor: (loading || overBudget) ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : '0 2px 8px rgba(124,58,237,0.3)' }}>
            {loading ? 'Running query…' : overBudget ? 'Budget exhausted' : 'Run DP query'}
          </button>

          <button onClick={() => { setResults([]); setBudgetSpent(0) }}
            style={{ width: '100%', marginTop: 8, padding: '8px 0', background: 'transparent',
              color: '#9ca3af', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10,
              fontSize: 12, cursor: 'pointer' }}>
            Reset session & budget
          </button>
        </div>

        {/* Right: results */}
        <div>
          {results.length === 0 && !loading && (
            <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 14,
              padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1D1D1F', marginBottom: 6 }}>
                No queries run yet
              </div>
              <div style={{ fontSize: 13, color: '#6E6E73', lineHeight: 1.6, maxWidth: 360, margin: '0 auto' }}>
                Configure a query on the left and click Run. Each result consumes
                epsilon from your session budget of ε={BUDGET_TOTAL}.
              </div>
            </div>
          )}

          {results.map((r, i) => (
            <ResultCard key={r.ts} result={r} cohortName={r.cohortName} />
          ))}
        </div>
      </div>

      {/* Theory footer */}
      <div style={{ marginTop: 24, padding: '16px 20px',
        background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.12)',
        borderRadius: 12, fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
        <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 6, fontSize: 13 }}>
          How it works — Laplace Mechanism
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px' }}>
          {[
            '📐 Noise drawn from Laplace(0, Δf/ε) where Δf is global sensitivity',
            '🔢 Count queries: Δf = 1 (adding/removing one record changes count by 1)',
            '📊 Mean queries: Δf = (max−min)/n (bounded sensitivity)',
            '🥧 Proportion queries: Δf = 1/n (each record changes proportion by at most 1/n)',
            '🔗 Sequential composition: total ε = sum of all query epsilons',
            '🛡 δ = 10⁻⁵ throughout — probability of catastrophic privacy failure',
          ].map(r => <div key={r} style={{ fontSize: 12, color: '#475569' }}>{r}</div>)}
        </div>
      </div>
    </div>
  )
}
