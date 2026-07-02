import React, { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const STATUS_CONFIG = {
  pending: {
    label: 'Under review',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    icon: '⏳',
    description: 'Your application is being reviewed by the Data Access Committee.',
  },
  approved: {
    label: 'Approved',
    color: '#059669',
    bg: '#f0fdf4',
    border: '#a7f3d0',
    icon: '✅',
    description: 'Access granted. You can now launch analyses in the Trusted Research Environment.',
  },
  rejected: {
    label: 'Not approved',
    color: '#dc2626',
    bg: '#fef2f2',
    border: '#fecaca',
    icon: '✗',
    description: 'Your application was not approved at this time.',
  },
}

function daysSince(isoStr) {
  if (!isoStr) return null
  const diff = Date.now() - new Date(isoStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function ApplicationCard({ req, onLaunch }) {
  const cfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: '#fff', border: '1px solid rgba(0,0,0,0.07)',
      borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      {/* Status stripe */}
      <div style={{ height: 3, background: cfg.color }} />

      <div style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1D1D1F', marginBottom: 3, lineHeight: 1.3 }}>
              {req.cohort_name || req.research_area || 'Unnamed cohort'}
            </div>
            <div style={{ fontSize: 12, color: '#6E6E73' }}>
              Submitted {daysSince(req.created_at)}
              {req.institution && ` · ${req.institution}`}
            </div>
          </div>

          {/* Status badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: cfg.bg, border: `1px solid ${cfg.border}`,
            borderRadius: 99, padding: '4px 12px', flexShrink: 0,
          }}>
            <span style={{ fontSize: 12 }}>{cfg.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
          </div>
        </div>

        {/* Status message */}
        <div style={{
          marginTop: 14, padding: '10px 14px',
          background: cfg.bg, borderRadius: 9,
          fontSize: 12, color: cfg.color === '#dc2626' ? '#991b1b' : '#374151',
          lineHeight: 1.6,
        }}>
          {cfg.description}
          {req.status === 'rejected' && req.rejection_reason && (
            <div style={{ marginTop: 6, color: '#dc2626', fontWeight: 500 }}>
              Reason: {req.rejection_reason}
            </div>
          )}
        </div>

        {/* Research area detail (expandable) */}
        {req.research_area && req.research_area !== req.cohort_name && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setExpanded(v => !v)}
              style={{ background: 'none', border: 'none', color: '#007AFF', fontSize: 12,
                fontWeight: 500, cursor: 'pointer', padding: 0 }}>
              {expanded ? 'Hide application detail ▲' : 'View application detail ▼'}
            </button>
            {expanded && (
              <div style={{ marginTop: 8, padding: '10px 14px', background: '#f8fafc',
                borderRadius: 8, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
                <strong>Research area:</strong> {req.research_area}
                {req.role && <><br /><strong>Role:</strong> {req.role}</>}
              </div>
            )}
          </div>
        )}

        {/* CTA row */}
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {req.status === 'approved' && (
            <button
              onClick={() => onLaunch(req)}
              style={{
                padding: '8px 20px', background: '#059669', color: '#fff',
                border: 'none', borderRadius: 9, fontWeight: 600, fontSize: 13,
                cursor: 'pointer', boxShadow: '0 2px 6px rgba(5,150,105,0.3)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#047857'}
              onMouseLeave={e => e.currentTarget.style.background = '#059669'}>
              Enter TRE →
            </button>
          )}
          {req.status === 'pending' && (
            <div style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center', lineHeight: 1.5 }}>
              Expected response within 10 working days. You'll receive an email when a decision is made.
            </div>
          )}
          {req.status === 'rejected' && (
            <div style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center' }}>
              You may reapply for a different cohort or contact the DAC for guidance.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MyApplications({ session, onBrowseCatalogue, onLaunchStudy }) {
  const [apps,    setApps]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [filter,  setFilter]  = useState('all')

  const email = session?.user?.email

  useEffect(() => {
    if (!email) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('access_requests')
      .select('*')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setError(error.message); setLoading(false); return }
        setApps(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [email])

  const counts = {
    all:      apps.length,
    pending:  apps.filter(a => a.status === 'pending').length,
    approved: apps.filter(a => a.status === 'approved').length,
    rejected: apps.filter(a => a.status === 'rejected').length,
  }
  const visible = filter === 'all' ? apps : apps.filter(a => a.status === filter)

  const handleLaunch = req => {
    if (onLaunchStudy) { onLaunchStudy(req); return }
    if (onBrowseCatalogue) onBrowseCatalogue()
  }

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#1D1D1F',
          margin: 0, marginBottom: 4 }}>
          My Access Applications
        </h1>
        <p style={{ fontSize: 13, color: '#6E6E73', margin: 0, lineHeight: 1.5 }}>
          Track your data access requests and launch approved studies in the TRE.
        </p>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total applications', value: counts.all, icon: '📋', color: '#374151' },
          { label: 'Under review', value: counts.pending, icon: '⏳', color: '#d97706' },
          { label: 'Approved', value: counts.approved, icon: '✅', color: '#059669' },
          { label: 'Not approved', value: counts.rejected, icon: '✗', color: '#dc2626' },
        ].map(s => (
          <div key={s.label} style={{ flex: '1 1 130px', background: '#fff',
            border: '1px solid rgba(0,0,0,0.07)', borderRadius: 12,
            padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>
              {loading ? '…' : s.value}
            </div>
            <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 3, fontWeight: 500 }}>
              {s.icon} {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      {!loading && !error && apps.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {[['all', 'All'], ['pending', 'Under review'], ['approved', 'Approved'], ['rejected', 'Not approved']].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{
                padding: '5px 14px', borderRadius: 99, fontSize: 12,
                fontWeight: filter === k ? 600 : 500, cursor: 'pointer',
                border: `1px solid ${filter === k ? '#007AFF' : 'rgba(0,0,0,0.1)'}`,
                background: filter === k ? '#007AFF' : '#fff',
                color: filter === k ? '#fff' : '#374151',
                transition: 'all 0.12s',
              }}>
              {label}
              {counts[k] > 0 && (
                <span style={{ marginLeft: 6, background: filter === k ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                  color: filter === k ? '#fff' : '#6b7280', borderRadius: 99,
                  padding: '0 5px', fontSize: 10, fontWeight: 700 }}>
                  {counts[k]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
          padding: '16px 20px', color: '#991b1b', fontSize: 13, marginBottom: 16 }}>
          <strong>Could not load applications:</strong> {error}
          <br />
          <span style={{ fontSize: 12, color: '#b91c1c' }}>
            Make sure the Supabase RLS migration has been applied (supabase_access_requests_v2.sql).
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'grid', gap: 14 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 14, padding: 20 }}>
              <div style={{ height: 14, background: '#f3f4f6', borderRadius: 6, width: '50%', marginBottom: 10 }} />
              <div style={{ height: 11, background: '#f3f4f6', borderRadius: 6, width: '30%', marginBottom: 16 }} />
              <div style={{ height: 36, background: '#f3f4f6', borderRadius: 9 }} />
            </div>
          ))}
        </div>
      )}

      {/* Empty — no applications at all */}
      {!loading && !error && apps.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff',
          borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>📋</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: '#1D1D1F', marginBottom: 6 }}>
            No applications yet
          </div>
          <div style={{ fontSize: 13, color: '#6E6E73', marginBottom: 20, lineHeight: 1.6, maxWidth: 360, margin: '0 auto 20px' }}>
            Browse the data catalogue and apply for access to cohorts that fit your research.
          </div>
          <button onClick={onBrowseCatalogue}
            style={{ padding: '10px 24px', background: '#007AFF', color: '#fff',
              border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,122,255,0.3)' }}>
            Browse Data Catalogue →
          </button>
        </div>
      )}

      {/* Empty — filtered to zero */}
      {!loading && !error && apps.length > 0 && visible.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', background: '#fff',
          borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)', color: '#6E6E73', fontSize: 13 }}>
          No {filter} applications.
        </div>
      )}

      {/* Application cards */}
      {!loading && !error && visible.length > 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {visible.map(req => (
            <ApplicationCard key={req.id} req={req} onLaunch={handleLaunch} />
          ))}
        </div>
      )}

      {/* Browse more CTA */}
      {!loading && !error && apps.length > 0 && (
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={onBrowseCatalogue}
            style={{ padding: '8px 18px', background: 'rgba(0,122,255,0.07)',
              color: '#007AFF', border: '1px solid rgba(0,122,255,0.2)', borderRadius: 9,
              fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            ← Browse more cohorts
          </button>
          <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
            Questions about your application? Contact the Data Access Committee.
          </div>
        </div>
      )}

      {/* Five Safes notice */}
      <div style={{ marginTop: 24, padding: '14px 18px', background: 'rgba(0,122,255,0.04)',
        border: '1px solid rgba(0,122,255,0.12)', borderRadius: 12,
        fontSize: 12, color: '#374151', lineHeight: 1.7 }}>
        <strong style={{ color: '#007AFF' }}>Five Safes governance.</strong>{' '}
        All access decisions are made by the Data Access Committee under the UK Five Safes framework.
        Approved researchers access data exclusively within the Trusted Research Environment —
        raw data never leaves its source institution.
      </div>
    </div>
  )
}
