import React, { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

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
      letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
      {modality}
    </span>
  )
}

function StudyStatusBadge({ status }) {
  const cfg = {
    running:   { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', dot: true },
    completed: { color: '#059669', bg: '#f0fdf4', border: '#a7f3d0', dot: false },
    failed:    { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', dot: false },
    pending:   { color: '#d97706', bg: '#fffbeb', border: '#fde68a', dot: false },
  }[status] || { color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb', dot: false }

  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {cfg.dot && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color,
          boxShadow: `0 0 5px ${cfg.color}`, animation: 'pulse 1.5s infinite' }} />
      )}
      {status}
    </span>
  )
}

function daysSince(isoStr) {
  if (!isoStr) return ''
  const d = Math.floor((Date.now() - new Date(isoStr)) / 86400000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

function CohortWorkspaceCard({ req, cohort, onLaunch, isHighlighted }) {
  const modality = cohort?.modality || 'mixed'

  return (
    <div style={{
      background: '#fff',
      border: isHighlighted ? '2px solid #059669' : '1px solid rgba(0,0,0,0.07)',
      borderRadius: 14,
      boxShadow: isHighlighted
        ? '0 0 0 4px rgba(5,150,105,0.1), 0 4px 16px rgba(0,0,0,0.08)'
        : '0 2px 8px rgba(0,0,0,0.04)',
      overflow: 'hidden',
      transition: 'box-shadow 0.2s',
    }}>
      {/* Green approved stripe */}
      <div style={{ height: 3, background: 'linear-gradient(90deg,#059669,#10b981)' }} />

      <div style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {cohort && <div style={{ marginBottom: 6 }}><ModalityBadge modality={modality} /></div>}
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1D1D1F', lineHeight: 1.3, marginBottom: 3 }}>
              {req.cohort_name || req.research_area}
            </div>
            {cohort && (
              <div style={{ fontSize: 12, color: '#6E6E73' }}>
                🏥 {cohort.contributing_institution}
                {cohort.sample_count && ` · ${(cohort.sample_count / 1000).toFixed(1)}k participants`}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
            <span style={{ background: '#f0fdf4', color: '#059669', border: '1px solid #a7f3d0',
              borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>
              ✓ Access approved
            </span>
            <span style={{ fontSize: 10, color: '#9ca3af' }}>
              {req.reviewed_at ? `Approved ${daysSince(req.reviewed_at)}` : `Applied ${daysSince(req.created_at)}`}
            </span>
          </div>
        </div>

        {/* Cohort metadata strip */}
        {cohort && (
          <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Format', value: cohort.data_format },
              { label: 'Disease', value: cohort.disease_area },
              { label: 'Age range', value: cohort.age_range_min && cohort.age_range_max
                ? `${cohort.age_range_min}–${cohort.age_range_max} yrs` : null },
              { label: 'Longitudinal', value: cohort.longitudinal ? 'Yes' : 'No' },
            ].filter(s => s.value).map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Research context */}
        {req.research_area && (
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px',
            fontSize: 12, color: '#475569', lineHeight: 1.5, marginBottom: 14 }}>
            <strong>Your research:</strong> {req.research_area}
          </div>
        )}

        <button
          onClick={() => onLaunch(req, cohort)}
          style={{
            width: '100%', padding: '10px 0', background: '#059669',
            color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600,
            fontSize: 13, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(5,150,105,0.3)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#047857'}
          onMouseLeave={e => e.currentTarget.style.background = '#059669'}>
          Launch FL Analysis →
        </button>
      </div>
    </div>
  )
}

function RecentStudyRow({ study }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
      borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1D1D1F',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {study.model_name || study.id?.slice(0, 8)}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          {study.dataset_name || '—'}
          {study.rounds_total && ` · ${study.rounds_total} rounds`}
          {study.created_at && ` · ${daysSince(study.created_at)}`}
        </div>
      </div>
      <StudyStatusBadge status={study.status} />
      {study.best_accuracy && (
        <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed',
          background: '#f5f3ff', padding: '3px 10px', borderRadius: 99,
          border: '1px solid #ddd6fe', whiteSpace: 'nowrap' }}>
          {(study.best_accuracy * 100).toFixed(1)}%
        </div>
      )}
    </div>
  )
}

export default function TREWorkspace({ session, initialCohort, onLaunchStudy, studies = [] }) {
  const [approvedApps, setApprovedApps] = useState([])
  const [cohortMap,    setCohortMap]    = useState({})
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  const email = session?.user?.email

  useEffect(() => {
    if (!email) return
    let cancelled = false
    setLoading(true)

    supabase
      .from('access_requests')
      .select('*')
      .eq('email', email)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .then(async ({ data: apps, error: appsErr }) => {
        if (cancelled) return
        if (appsErr) { setError(appsErr.message); setLoading(false); return }
        if (!apps?.length) { setApprovedApps([]); setLoading(false); return }

        // Fetch cohort details for all approved apps that have a cohort_id
        const cohortIds = [...new Set(apps.filter(a => a.cohort_id).map(a => a.cohort_id))]
        if (cohortIds.length > 0) {
          const { data: cohorts } = await supabase
            .from('cohorts')
            .select('*')
            .in('id', cohortIds)
          if (!cancelled && cohorts) {
            const map = {}
            cohorts.forEach(c => { map[c.id] = c })
            setCohortMap(map)
          }
        }
        if (!cancelled) { setApprovedApps(apps); setLoading(false) }
      })

    return () => { cancelled = true }
  }, [email])

  const recentStudies = studies.slice(0, 5)
  const runningCount  = studies.filter(s => s.status === 'running').length

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em',
            color: '#1D1D1F', margin: 0 }}>
            Trusted Research Environment
          </h1>
          <span style={{ background: '#f0fdf4', color: '#059669', border: '1px solid #a7f3d0',
            borderRadius: 99, padding: '3px 12px', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.03em' }}>
            SECURE
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#6E6E73', margin: 0, lineHeight: 1.5 }}>
          Your approved datasets are available here. All analyses run inside the TRE —
          raw data never leaves its source institution.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        {[
          { label: 'Approved datasets', value: loading ? '…' : approvedApps.length, icon: '🔓', color: '#059669' },
          { label: 'Studies run', value: studies.length, icon: '🧪', color: '#7c3aed' },
          { label: 'Currently running', value: runningCount, icon: '⚡', color: runningCount > 0 ? '#7c3aed' : '#9ca3af' },
          { label: 'TRE status', value: 'Online', icon: '🟢', color: '#059669' },
        ].map(s => (
          <div key={s.label} style={{ flex: '1 1 130px', background: '#fff',
            border: '1px solid rgba(0,0,0,0.07)', borderRadius: 12,
            padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 3, fontWeight: 500 }}>
              {s.icon} {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Approved datasets section */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1D1D1F',
          marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          Approved datasets
          {!loading && approvedApps.length > 0 && (
            <span style={{ background: '#f0fdf4', color: '#059669', border: '1px solid #a7f3d0',
              borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
              {approvedApps.length}
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
            padding: '14px 18px', color: '#991b1b', fontSize: 13 }}>
            <strong>Could not load workspace:</strong> {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: 'grid', gap: 14 }}>
            {[1, 2].map(i => (
              <div key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 14, padding: 20 }}>
                <div style={{ height: 14, background: '#f3f4f6', borderRadius: 6, width: '55%', marginBottom: 10 }} />
                <div style={{ height: 11, background: '#f3f4f6', borderRadius: 6, width: '35%', marginBottom: 16 }} />
                <div style={{ height: 40, background: '#f3f4f6', borderRadius: 10 }} />
              </div>
            ))}
          </div>
        )}

        {/* No approved datasets */}
        {!loading && !error && approvedApps.length === 0 && (
          <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14,
            padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1D1D1F', marginBottom: 6 }}>
              No approved datasets yet
            </div>
            <div style={{ fontSize: 13, color: '#6E6E73', lineHeight: 1.6, maxWidth: 340, margin: '0 auto 16px' }}>
              Browse the data catalogue and apply for access. Approved applications appear here
              as analysis-ready workspaces.
            </div>
          </div>
        )}

        {/* Approved dataset cards */}
        {!loading && !error && approvedApps.length > 0 && (
          <div style={{ display: 'grid', gap: 14 }}>
            {approvedApps.map(req => (
              <CohortWorkspaceCard
                key={req.id}
                req={req}
                cohort={cohortMap[req.cohort_id] || null}
                onLaunch={onLaunchStudy}
                isHighlighted={initialCohort?.id === req.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent studies */}
      {studies.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 14, padding: '18px 20px', marginBottom: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1D1D1F', marginBottom: 14 }}>
            Recent studies
          </div>
          {recentStudies.map(s => <RecentStudyRow key={s.id} study={s} />)}
          {studies.length > 5 && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 10, textAlign: 'center' }}>
              +{studies.length - 5} more in Studies tab
            </div>
          )}
        </div>
      )}

      {/* TRE rules notice */}
      <div style={{ padding: '16px 20px', background: 'rgba(124,58,237,0.04)',
        border: '1px solid rgba(124,58,237,0.12)', borderRadius: 12,
        fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
        <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 6, fontSize: 13 }}>
          TRE Operating Rules
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px' }}>
          {[
            '🔐 All analyses run inside the secure enclave',
            '📊 Outputs reviewed before download (disclosure control)',
            '🚫 No raw data export — aggregated results only',
            '📋 All activity is audit-logged under Five Safes',
            '🤝 Access scoped to approved cohorts only',
            '⏱ Sessions logged with timestamp and user identity',
          ].map(r => (
            <div key={r} style={{ fontSize: 12, color: '#475569', padding: '2px 0' }}>{r}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
