import React, { useState, useEffect, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// ── constants ─────────────────────────────────────────────────────────────────

const MODALITIES = ['All', 'OCT', 'fundus', 'MRI', 'CT', 'EEG', 'histopathology', 'mixed']
const DISEASES   = ['All', 'Glaucoma', 'Age-related Macular Degeneration', 'Diabetic Retinopathy',
                    'Neuroscience', 'Alzheimer\'s Disease', 'Epilepsy', 'Multiple Sclerosis',
                    'Keratoconus', 'Other']
const ACCESS     = ['All', 'application_required', 'open', 'restricted']

const MODALITY_COLORS = {
  OCT:              ['#eff6ff', '#1d4ed8', '#bfdbfe'],
  fundus:           ['#f0fdf4', '#15803d', '#bbf7d0'],
  MRI:              ['#fdf4ff', '#7e22ce', '#e9d5ff'],
  CT:               ['#fff7ed', '#c2410c', '#fed7aa'],
  EEG:              ['#fefce8', '#a16207', '#fef08a'],
  histopathology:   ['#fdf2f8', '#be185d', '#fbcfe8'],
  mixed:            ['#f8fafc', '#475569', '#e2e8f0'],
}

const ACCESS_LABEL = {
  open:                 { label: 'Open access',         color: '#059669', bg: '#f0fdf4', border: '#a7f3d0' },
  application_required: { label: 'Apply for access',    color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  restricted:           { label: 'Restricted',          color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
}

// ── tiny helpers ──────────────────────────────────────────────────────────────

function fmtCount(n) {
  if (!n) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return n.toLocaleString()
}

function ModalityBadge({ modality }) {
  const [bg, text, border] = MODALITY_COLORS[modality] || MODALITY_COLORS.mixed
  return (
    <span style={{ background: bg, color: text, border: `1px solid ${border}`,
      padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
      {modality}
    </span>
  )
}

function AccessBadge({ type }) {
  const a = ACCESS_LABEL[type] || ACCESS_LABEL.application_required
  return (
    <span style={{ background: a.bg, color: a.color, border: `1px solid ${a.border}`,
      padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      whiteSpace: 'nowrap' }}>
      {a.label}
    </span>
  )
}

// ── access request modal ──────────────────────────────────────────────────────

function AccessRequestModal({ cohort, onClose, session }) {
  const [form, setForm] = useState({
    full_name: session?.user?.user_metadata?.full_name || '',
    email:     session?.user?.email || '',
    institution: session?.user?.user_metadata?.institution || '',
    role: '',
    research_area: '',
    project_description: '',
  })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err,  setErr]  = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.from('access_requests').insert({
      email:         form.email,
      full_name:     form.full_name,
      institution:   form.institution,
      role:          form.role,
      research_area: form.research_area,
      cohort_id:     cohort.id,
      cohort_name:   cohort.name,
      status:        'pending',
      created_at:    new Date().toISOString(),
    })
    if (error) { setErr(error.message); setBusy(false); return }
    setDone(true); setBusy(false)
  }

  const inp = {
    width: '100%', padding: '9px 13px', border: '1px solid rgba(0,0,0,0.1)',
    borderRadius: 9, fontSize: 13, outline: 'none', marginBottom: 12,
    color: '#1D1D1F', background: 'rgba(0,0,0,0.03)', fontFamily: 'inherit',
    boxSizing: 'border-box',
  }
  const lbl = {
    display: 'block', fontSize: 11, fontWeight: 600, color: '#6E6E73',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 18, padding: '28px 28px 24px',
        maxWidth: 500, width: '100%', boxShadow: '0 32px 80px rgba(0,0,0,0.25)',
        maxHeight: '90vh', overflowY: 'auto' }}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Application submitted</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6, lineHeight: 1.6 }}>
              Your request to access <strong>{cohort.name}</strong> has been received.
              We typically respond within 10 working days.
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20 }}>
              Confirmation sent to {form.email}
            </div>
            <button onClick={onClose} style={{ padding: '10px 24px', background: '#007AFF',
              color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600,
              fontSize: 14, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#1D1D1F', marginBottom: 4 }}>
                  Apply for access
                </div>
                <div style={{ fontSize: 12, color: '#6E6E73', lineHeight: 1.5 }}>
                  {cohort.name}
                </div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none',
                fontSize: 20, cursor: 'pointer', color: '#9ca3af', padding: '0 4px', lineHeight: 1 }}>
                ×
              </button>
            </div>

            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px',
              marginBottom: 18, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
              <strong>Data Use Conditions:</strong>{' '}
              {cohort.data_use_conditions?.join(' · ') || 'Research use only'}
            </div>

            <form onSubmit={submit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <div style={{ paddingRight: 8 }}>
                  <label style={lbl}>Full name *</label>
                  <input style={inp} required placeholder="Dr. Jane Smith"
                    value={form.full_name} onChange={e => set('full_name', e.target.value)} />
                </div>
                <div style={{ paddingLeft: 8 }}>
                  <label style={lbl}>Email *</label>
                  <input style={inp} type="email" required placeholder="you@institution.ac.uk"
                    value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>
              <label style={lbl}>Institution *</label>
              <input style={inp} required placeholder="University / Hospital / Company"
                value={form.institution} onChange={e => set('institution', e.target.value)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <div style={{ paddingRight: 8 }}>
                  <label style={lbl}>Your role *</label>
                  <input style={inp} required placeholder="e.g. Clinical researcher"
                    value={form.role} onChange={e => set('role', e.target.value)} />
                </div>
                <div style={{ paddingLeft: 8 }}>
                  <label style={lbl}>Research area *</label>
                  <input style={inp} required placeholder="e.g. Glaucoma detection"
                    value={form.research_area} onChange={e => set('research_area', e.target.value)} />
                </div>
              </div>
              <label style={lbl}>Project description *</label>
              <textarea style={{ ...inp, resize: 'vertical', marginBottom: 16 }} rows={3}
                required placeholder="Briefly describe your research question and how you intend to use this dataset…"
                value={form.project_description} onChange={e => set('project_description', e.target.value)} />
              {err && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 8, padding: '8px 12px', color: '#991b1b',
                  fontSize: 13, marginBottom: 12 }}>
                  {err}
                </div>
              )}
              <button type="submit" disabled={busy} style={{
                width: '100%', padding: '12px 0', background: busy ? 'rgba(0,122,255,0.5)' : '#007AFF',
                color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600,
                fontSize: 14, cursor: busy ? 'not-allowed' : 'pointer',
                boxShadow: busy ? 'none' : '0 2px 8px rgba(0,122,255,0.3)' }}>
                {busy ? 'Submitting…' : 'Submit application'}
              </button>
              <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 12, lineHeight: 1.6 }}>
                Your application is reviewed by the Data Access Committee within 10 working days.
                All access is governed under the Five Safes framework.
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ── cohort card ───────────────────────────────────────────────────────────────

function CohortCard({ cohort, onApply }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)',
      borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.02)',
      transition: 'box-shadow 0.15s', cursor: 'default' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.02)'}>

      {/* Header */}
      <div style={{ padding: '18px 20px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
              <ModalityBadge modality={cohort.modality} />
              {cohort.featured && (
                <span style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a',
                  padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>
                  Featured
                </span>
              )}
              {cohort.longitudinal && (
                <span style={{ background: '#f0f7ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                  padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600 }}>
                  Longitudinal
                </span>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1D1D1F', lineHeight: 1.3, marginBottom: 4 }}>
              {cohort.name}
            </div>
            <div style={{ fontSize: 12, color: '#6E6E73', display: 'flex', alignItems: 'center', gap: 4 }}>
              🏥 {cohort.contributing_institution}
            </div>
          </div>
          <AccessBadge type={cohort.access_type} />
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'Participants', value: fmtCount(cohort.sample_count) },
            { label: 'Age range', value: cohort.age_range_min && cohort.age_range_max
              ? `${cohort.age_range_min}–${cohort.age_range_max} yrs` : '—' },
            { label: 'Format', value: cohort.data_format || '—' },
            { label: 'Disease', value: cohort.disease_area },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>
                {s.label}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable description */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)', padding: '12px 20px' }}>
        <div style={{ fontSize: 12, color: '#6E6E73', lineHeight: 1.6,
          overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : 3,
          WebkitBoxOrient: 'vertical' }}>
          {cohort.description}
        </div>
        {cohort.description?.length > 180 && (
          <button onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', color: '#007AFF', fontSize: 12,
              fontWeight: 500, cursor: 'pointer', padding: '4px 0', marginTop: 2 }}>
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>

      {/* Tags */}
      {cohort.disease_tags?.length > 0 && (
        <div style={{ padding: '0 20px 12px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {cohort.disease_tags.slice(0, 6).map(t => (
            <span key={t} style={{ background: '#f1f5f9', color: '#475569', borderRadius: 4,
              fontSize: 10, fontWeight: 500, padding: '2px 8px' }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)', padding: '12px 20px',
        background: '#fafafa', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: '#9ca3af' }}>
          {cohort.consent_basis && (
            <span title="Consent basis">🔐 {cohort.consent_basis.replace(/_/g, ' ')}</span>
          )}
          {cohort.dspt_compliant && (
            <span title="DSPT compliant">🏥 DSPT</span>
          )}
          {cohort.ethics_reference && (
            <span title="Ethics reference">📋 {cohort.ethics_reference}</span>
          )}
        </div>
        <button onClick={() => onApply(cohort)}
          style={{ padding: '7px 18px', background: '#007AFF', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12,
            cursor: 'pointer', whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0,122,255,0.3)', transition: 'all 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background = '#0062cc'}
          onMouseLeave={e => e.currentTarget.style.background = '#007AFF'}>
          Apply for access →
        </button>
      </div>
    </div>
  )
}

// ── filter chip ───────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: active ? 600 : 500,
      cursor: 'pointer', border: `1px solid ${active ? '#007AFF' : 'rgba(0,0,0,0.1)'}`,
      background: active ? '#007AFF' : '#fff', color: active ? '#fff' : '#374151',
      transition: 'all 0.12s', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  )
}

// ── main catalogue component ──────────────────────────────────────────────────

export default function DataCatalogue({ session }) {
  const [cohorts,   setCohorts]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [search,    setSearch]    = useState('')
  const [modality,  setModality]  = useState('All')
  const [disease,   setDisease]   = useState('All')
  const [access,    setAccess]    = useState('All')
  const [applying,  setApplying]  = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('cohorts')
      .select('*')
      .eq('status', 'published')
      .order('featured', { ascending: false })
      .order('sample_count', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setError(error.message); setLoading(false); return }
        setCohorts(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return cohorts.filter(c => {
      if (modality !== 'All' && c.modality !== modality) return false
      if (disease  !== 'All' && c.disease_area !== disease) return false
      if (access   !== 'All' && c.access_type  !== access)  return false
      if (!q) return true
      return (
        c.name?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.contributing_institution?.toLowerCase().includes(q) ||
        c.disease_area?.toLowerCase().includes(q) ||
        c.disease_tags?.some(t => t.toLowerCase().includes(q))
      )
    })
  }, [cohorts, modality, disease, access, search])

  const totalSamples  = cohorts.reduce((sum, c) => sum + (c.sample_count || 0), 0)
  const institutions  = [...new Set(cohorts.map(c => c.contributing_institution))].length
  const activeFilters = (modality !== 'All' ? 1 : 0) + (disease !== 'All' ? 1 : 0) +
                        (access !== 'All' ? 1 : 0) + (search ? 1 : 0)

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif' }}>

      {/* ── hero header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em',
          color: '#1D1D1F', margin: 0, marginBottom: 4 }}>
          Data Catalogue
        </h1>
        <p style={{ fontSize: 13, color: '#6E6E73', margin: 0, lineHeight: 1.5 }}>
          Browse governed, harmonised research datasets. No login required to explore.
          Apply for access to run analyses in the Trusted Research Environment.
        </p>
      </div>

      {/* ── stats banner ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Cohorts', value: cohorts.length, icon: '🗂' },
          { label: 'Total participants', value: fmtCount(totalSamples), icon: '👥' },
          { label: 'Contributing institutions', value: institutions, icon: '🏥' },
          { label: 'Modalities', value: [...new Set(cohorts.map(c => c.modality))].length, icon: '🔬' },
        ].map(s => (
          <div key={s.label} style={{ flex: '1 1 140px', background: '#fff',
            border: '1px solid rgba(0,0,0,0.07)', borderRadius: 12,
            padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1D1D1F', lineHeight: 1 }}>
              {loading ? '…' : s.value}
            </div>
            <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 3, fontWeight: 500 }}>
              {s.icon} {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── search ── */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
          color: '#9ca3af', fontSize: 16, pointerEvents: 'none' }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by cohort name, disease, institution, or keyword…"
          style={{ width: '100%', padding: '11px 14px 11px 38px', border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 10, fontSize: 13, outline: 'none', color: '#1D1D1F',
            background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box',
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }} />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>
            ×
          </button>
        )}
      </div>

      {/* ── filters ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 8 }}>
            Modality
          </span>
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
            {MODALITIES.map(m => (
              <FilterChip key={m} label={m} active={modality === m}
                onClick={() => setModality(modality === m ? 'All' : m)} />
            ))}
          </span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 8 }}>
            Access
          </span>
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
            {ACCESS.map(a => (
              <FilterChip key={a} label={a === 'All' ? 'All' : ACCESS_LABEL[a]?.label || a}
                active={access === a} onClick={() => setAccess(access === a ? 'All' : a)} />
            ))}
          </span>
        </div>

        {activeFilters > 0 && (
          <button onClick={() => { setModality('All'); setDisease('All'); setAccess('All'); setSearch('') }}
            style={{ background: 'none', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
              padding: '4px 12px', fontSize: 12, color: '#6E6E73', cursor: 'pointer', marginTop: 4 }}>
            Clear all filters
          </button>
        )}
      </div>

      {/* ── results header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: '#6E6E73', fontWeight: 500 }}>
          {loading ? 'Loading cohorts…' : `${filtered.length} cohort${filtered.length !== 1 ? 's' : ''}`}
          {activeFilters > 0 && !loading && (
            <span style={{ color: '#9ca3af' }}> · {activeFilters} filter{activeFilters > 1 ? 's' : ''} active</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          Sorted by: featured · size
        </div>
      </div>

      {/* ── error state ── */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
          padding: '16px 20px', color: '#991b1b', fontSize: 13, marginBottom: 16 }}>
          <strong>Could not load catalogue:</strong> {error}
          <br />
          <span style={{ fontSize: 12, color: '#b91c1c' }}>
            Make sure the Supabase migration has been run.
          </span>
        </div>
      )}

      {/* ── loading skeleton ── */}
      {loading && (
        <div style={{ display: 'grid', gap: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 14, padding: 20, animation: 'pulse 1.5s ease-in-out infinite' }}>
              <div style={{ height: 14, background: '#f3f4f6', borderRadius: 6, width: '60%', marginBottom: 10 }} />
              <div style={{ height: 12, background: '#f3f4f6', borderRadius: 6, width: '40%', marginBottom: 16 }} />
              <div style={{ height: 10, background: '#f3f4f6', borderRadius: 6, width: '90%', marginBottom: 6 }} />
              <div style={{ height: 10, background: '#f3f4f6', borderRadius: 6, width: '75%' }} />
            </div>
          ))}
        </div>
      )}

      {/* ── empty state ── */}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff',
          borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🔬</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1D1D1F', marginBottom: 6 }}>
            No cohorts match your filters
          </div>
          <div style={{ fontSize: 13, color: '#6E6E73', marginBottom: 16 }}>
            Try removing some filters or broadening your search.
          </div>
          <button onClick={() => { setModality('All'); setDisease('All'); setAccess('All'); setSearch('') }}
            style={{ padding: '8px 20px', background: '#007AFF', color: '#fff', border: 'none',
              borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Clear filters
          </button>
        </div>
      )}

      {/* ── cohort grid ── */}
      {!loading && !error && filtered.length > 0 && (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map(c => (
            <CohortCard key={c.id} cohort={c} onApply={setApplying} />
          ))}
        </div>
      )}

      {/* ── footer note ── */}
      {!loading && !error && (
        <div style={{ marginTop: 24, padding: '14px 18px', background: 'rgba(0,122,255,0.04)',
          border: '1px solid rgba(0,122,255,0.12)', borderRadius: 12,
          fontSize: 12, color: '#374151', lineHeight: 1.7 }}>
          <strong style={{ color: '#007AFF' }}>Five Safes governance.</strong>{' '}
          All datasets on this platform are governed under the UK Five Safes framework
          (Safe People, Safe Projects, Safe Settings, Safe Data, Safe Outputs).
          Access is subject to Data Access Committee review.
          Analyses run inside a Trusted Research Environment — raw data never leaves its source.
        </div>
      )}

      {/* ── access request modal ── */}
      {applying && (
        <AccessRequestModal
          cohort={applying}
          session={session}
          onClose={() => setApplying(null)}
        />
      )}
    </div>
  )
}
