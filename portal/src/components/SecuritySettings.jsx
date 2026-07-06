import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const card = { background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 16 }
const btn = (bg, color) => ({ padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: bg, color })

export default function SecuritySettings() {
  const [factors, setFactors] = useState([])
  const [enrolling, setEnrolling] = useState(null)   // { id, qr, secret }
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadFactors = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (!error) setFactors(data?.totp || [])
  }, [])

  useEffect(() => { loadFactors() }, [loadFactors])

  const startEnrol = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `authenticator-${Date.now() % 10000}` })
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  const confirmEnrol = async () => {
    if (!code.trim()) return
    setBusy(true); setMsg(null)
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.id })
    if (chErr) { setBusy(false); setMsg({ type: 'error', text: chErr.message }); return }
    const { error } = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: challenge.id, code: code.trim() })
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: 'Invalid code — try again. ' + error.message }); return }
    setMsg({ type: 'ok', text: 'Two-factor authentication enabled. You will be asked for a code at sign-in.' })
    setEnrolling(null); setCode('')
    loadFactors()
  }

  const unenrol = async (factorId) => {
    if (!confirm('Remove this authenticator? Sign-in will no longer require a code.')) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'ok', text: 'Authenticator removed.' }); loadFactors() }
  }

  const verified = factors.filter(f => f.status === 'verified')

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#1D1D1F', marginBottom: 4 }}>Security</h1>
      <p style={{ fontSize: 13, color: '#6E6E73', marginBottom: 20 }}>Multi-factor authentication for your UndosaTech account</p>

      {msg && (
        <div style={{ ...card, padding: 14, background: msg.type === 'ok' ? 'rgba(50,215,75,0.1)' : 'rgba(255,59,48,0.08)', color: msg.type === 'ok' ? '#1D7A2F' : '#C4281C', fontSize: 13, fontWeight: 500 }}>
          {msg.text}
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1D1D1F' }}>Authenticator app (TOTP)</div>
            <div style={{ fontSize: 13, color: '#6E6E73', marginTop: 2 }}>
              {verified.length > 0
                ? `✅ Enabled — ${verified.length} authenticator${verified.length > 1 ? 's' : ''} registered`
                : 'Add a 6-digit code step at sign-in using Google Authenticator, 1Password, Authy, etc.'}
            </div>
          </div>
          {!enrolling && (
            <button onClick={startEnrol} disabled={busy} style={btn('#007AFF', '#fff')}>
              {verified.length > 0 ? 'Add another' : 'Enable 2FA'}
            </button>
          )}
        </div>

        {enrolling && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>1. Scan this QR code with your authenticator app</div>
            <div style={{ background: '#fff', padding: 8, display: 'inline-block', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)' }}>
              {enrolling.qr.trim().startsWith('data:')
                ? <img src={enrolling.qr} alt="TOTP enrolment QR code" style={{ width: 180, height: 180, display: 'block' }} />
                : <div dangerouslySetInnerHTML={{ __html: enrolling.qr }} />}
            </div>
            <div style={{ fontSize: 12, color: '#6E6E73', margin: '10px 0 16px' }}>
              Or enter the secret manually: <code style={{ background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: 6 }}>{enrolling.secret}</code>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>2. Enter the 6-digit code shown in the app</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456" inputMode="numeric"
                style={{ width: 120, padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.15)', fontSize: 16, letterSpacing: 3, textAlign: 'center' }} />
              <button onClick={confirmEnrol} disabled={busy || code.length !== 6} style={btn('#32D74B', '#fff')}>Verify & enable</button>
              <button onClick={() => { setEnrolling(null); setCode('') }} style={btn('rgba(0,0,0,0.06)', '#6E6E73')}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {verified.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Registered authenticators</div>
          {factors.map(f => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{f.friendly_name || 'Authenticator'}</div>
                <div style={{ fontSize: 12, color: '#6E6E73' }}>
                  {f.status === 'verified' ? 'Verified' : 'Pending verification'} · added {new Date(f.created_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => unenrol(f.id)} disabled={busy} style={btn('rgba(255,59,48,0.1)', '#FF3B30')}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card, background: 'rgba(0,122,255,0.05)', fontSize: 12.5, color: '#3A3A3C', lineHeight: 1.6 }}>
        <strong style={{ color: '#007AFF' }}>Why this matters:</strong> NHS DSPT and institutional information governance
        expect multi-factor authentication for platforms handling research data. Once enabled, your account requires
        both your password and a time-based code to sign in (AAL2 assurance).
      </div>
    </div>
  )
}

// Shown after password sign-in when the account has a verified TOTP factor
export function MFAChallenge({ onVerified, onSignOut }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const verify = async () => {
    setBusy(true); setError(null)
    try {
      const { data: factorData, error: fErr } = await supabase.auth.mfa.listFactors()
      if (fErr) throw fErr
      const factor = (factorData?.totp || []).find(f => f.status === 'verified')
      if (!factor) throw new Error('No verified authenticator found')
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: factor.id })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: code.trim() })
      if (vErr) throw new Error('Invalid code — please try again')
      onVerified()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...card, width: 380, textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(145deg,#007AFF,#5856D6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 20, margin: '0 auto 14px' }}>U</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Two-factor authentication</div>
        <div style={{ fontSize: 13, color: '#6E6E73', marginBottom: 18 }}>Enter the 6-digit code from your authenticator app</div>
        <input autoFocus value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => e.key === 'Enter' && code.length === 6 && verify()}
          placeholder="123456" inputMode="numeric"
          style={{ width: 160, padding: '11px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.15)', fontSize: 20, letterSpacing: 5, textAlign: 'center', marginBottom: 14 }} />
        {error && <div style={{ fontSize: 12.5, color: '#FF3B30', marginBottom: 12 }}>{error}</div>}
        <button onClick={verify} disabled={busy || code.length !== 6}
          style={{ ...btn('#007AFF', '#fff'), width: '100%', padding: '11px 0', opacity: busy || code.length !== 6 ? 0.5 : 1 }}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button onClick={onSignOut} style={{ marginTop: 12, background: 'none', border: 'none', color: '#6E6E73', fontSize: 12.5, cursor: 'pointer' }}>
          Sign out and use a different account
        </button>
      </div>
    </div>
  )
}
