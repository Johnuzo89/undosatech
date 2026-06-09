import React, { useEffect, useState, useRef, useCallback, createContext, useContext } from 'react'
import { createClient } from '@supabase/supabase-js'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell } from 'recharts'
import NodeRegistry from './components/NodeRegistry'
import MyStudies from './components/MyStudies'
import AdminDashboard from './components/AdminDashboard'
import StudyInvitations from './components/StudyInvitations'

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || 'john@undosatech.com').split(',')

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: true, persistSession: true } }
)
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const INSTANT_DOMAINS = ['nhs.uk','nhs.net','ac.uk','edu','edu.au','ac.nz','ac.za','uni-','tu-','eth.ch','epfl.ch','cam.ac.uk','ox.ac.uk','ucl.ac.uk','imperial.ac.uk','kcl.ac.uk','ed.ac.uk','dundee.ac.uk','gla.ac.uk','abdn.ac.uk','st-andrews.ac.uk','hw.ac.uk','strath.ac.uk','napier.ac.uk']

function isInstitutional(email) {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase() || ''
  return INSTANT_DOMAINS.some(d => domain.includes(d))
}

async function apiFetch(path, opts={}, token=null) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const r = await fetch(`${API}${path}`, { ...opts, headers })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

const S = {
  card: { background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 22px', marginBottom:14 },
  inp:  { width:'100%', padding:'9px 12px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:14, outline:'none', marginBottom:12, color:'#111', background:'#fff', fontFamily:'inherit' },
  lbl:  { display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 },
}

const ARCH_INFO = {
  resnet18:       { name:'ResNet-18',       params:'11M' },
  resnet50:       { name:'ResNet-50',       params:'25M' },
  resnet101:      { name:'ResNet-101',      params:'44M' },
  efficientnet_b0:{ name:'EfficientNet-B0', params:'5M'  },
  efficientnet_b4:{ name:'EfficientNet-B4', params:'19M' },
  vit_b16:        { name:'ViT-B/16',        params:'86M' },
  cnn:            { name:'Lightweight CNN', params:'0.5M'},
}
const ARCHS = [
  {v:'resnet18',        l:'ResNet-18',        sub:'11M · Fast · Best general use'},
  {v:'resnet50',        l:'ResNet-50',        sub:'25M · Medium · Complex pathology'},
  {v:'resnet101',       l:'ResNet-101',       sub:'44M · Slow · High-res histology'},
  {v:'efficientnet_b0', l:'EfficientNet-B0',  sub:'5M · Fast · Resource efficient'},
  {v:'efficientnet_b4', l:'EfficientNet-B4',  sub:'19M · Medium · High accuracy'},
  {v:'vit_b16',         l:'ViT-B/16',         sub:'86M · Slow · Transformer'},
  {v:'cnn',             l:'Lightweight CNN',  sub:'0.5M · Fastest · Quick test'},
]
const DATASETS = [
  {v:'octmnist',       l:'OCTMNIST — Retinal OCT (4 classes)'},
  {v:'pathmnist',      l:'PathMNIST — Histopathology (9 classes)'},
  {v:'chestmnist',     l:'ChestMNIST — Chest X-Ray (14 classes)'},
  {v:'dermamnist',     l:'DermaMNIST — Skin Lesion (7 classes)'},
  {v:'breastmnist',    l:'BreastMNIST — Ultrasound (2 classes)'},
  {v:'bloodmnist',     l:'BloodMNIST — Blood Cells (8 classes)'},
  {v:'tissuemnist',    l:'TissueMNIST — Kidney Tissue (8 classes)'},
  {v:'retinamnist',    l:'RetinaMNIST — Retinal Fundus (5 classes)'},
  {v:'pneumoniamnist', l:'PneumoniaMNIST — Pneumonia (2 classes)'},
  {v:'organamnist',    l:'OrganAMNIST — Abdominal CT (11 classes)'},
  {v:'upload',         l:'Upload your own dataset'},
]
const PRESETS = [
  {v:'quick',    l:'Quick',    rounds:3, epochs:1},
  {v:'standard', l:'Standard', rounds:5, epochs:2},
  {v:'deep',     l:'Deep',     rounds:10,epochs:3},
  {v:'custom',   l:'Custom',   rounds:null,epochs:null},
]
const COLORS=['#1d4ed8','#059669','#7c3aed','#d97706','#dc2626','#0891b2','#65a30d','#9333ea','#f59e0b','#10b981','#6366f1','#ef4444','#14b8a6','#f97316']

function Badge({ status }) {
  const m = {pending:['#f3f4f6','#374151','#e5e7eb'],running:['#f5f3ff','#6d28d9','#ddd6fe'],completed:['#ecfdf5','#065f46','#a7f3d0'],failed:['#fef2f2','#991b1b','#fecaca'],cancelling:['#fff7ed','#c2410c','#fed7aa'],cancelled:['#f3f4f6','#6b7280','#e5e7eb']}
  const [bg,c,b] = m[status]||m.pending
  return <span style={{background:bg,color:c,border:`1px solid ${b}`,padding:'2px 10px',borderRadius:20,fontSize:11,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5}}>
    {status==='running'&&<span style={{width:6,height:6,borderRadius:'50%',background:'#7c3aed',animation:'pulse 1.2s infinite',display:'inline-block'}}/>}{status}
  </span>
}

function Stat({ label, value, color, sub }) {
  return <div style={{background:'#f9fafb',borderRadius:10,padding:'12px 16px',border:'1px solid #f3f4f6'}}>
    <div style={{fontSize:11,color:'#9ca3af',marginBottom:3,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div>
    <div style={{fontSize:20,fontWeight:700,color:color||'#111',lineHeight:1}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>{sub}</div>}
  </div>
}

// ── AUTH SCREENS ──────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email:'', password:'', name:'', institution:'', role:'', research_area:'' })
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)
  const [msg,  setMsg]  = useState(null)
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
    if (error) setErr(error.message)
  }

  const handleLogin = async e => {
    e.preventDefault(); setBusy(true); setErr(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
    if (error) { setErr(error.message); setBusy(false); return }
    onAuth(data.user, data.session)
    setBusy(false)
  }

  const handleSignup = async e => {
    e.preventDefault(); setBusy(true); setErr(null)
    const institutional = isInstitutional(form.email)
    if (!institutional) { setMode('apply'); setBusy(false); return }
    const { data, error } = await supabase.auth.signUp({
      email: form.email, password: form.password,
      options: { data: { full_name: form.name, institution: form.institution, role: form.role, account_type: 'institutional' } }
    })
    if (error) { setErr(error.message); setBusy(false); return }
    setMode('verify'); setBusy(false)
  }

  const handleApply = async e => {
    e.preventDefault(); setBusy(true); setErr(null)
    const { error } = await supabase.from('access_requests').insert({
      email: form.email, full_name: form.name,
      institution: form.institution, role: form.role,
      research_area: form.research_area, status: 'pending',
      created_at: new Date().toISOString()
    })
    if (error) { setErr('Could not submit application: ' + error.message); setBusy(false); return }
    setMsg('Application submitted! We will review it within 24 hours and email you.'); setBusy(false)
  }

  const inputStyle = {...S.inp, marginBottom:14}
  const btnPrimary = { width:'100%', padding:12, background:busy?'#93c5fd':'#1d4ed8', color:'#fff', borderRadius:8, fontWeight:700, fontSize:14, cursor:busy?'not-allowed':'pointer', border:'none', marginBottom:10 }
  const btnGoogle = { width:'100%', padding:11, background:'#fff', color:'#374151', borderRadius:8, fontWeight:600, fontSize:14, cursor:'pointer', border:'1px solid #e5e7eb', marginBottom:14, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{width:'100%',maxWidth:420}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{fontSize:28,fontWeight:800,color:'#fff',marginBottom:8}}>UndosaTech</div>
          <div style={{fontSize:14,color:'#94a3b8'}}>Federated Research Platform</div>
          <div style={{fontSize:12,color:'#64748b',marginTop:4}}>Privacy-preserving AI for medical science</div>
        </div>
        <div style={{background:'#fff',borderRadius:16,padding:28,boxShadow:'0 25px 50px rgba(0,0,0,0.4)'}}>
          {mode === 'verify' && (
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>📧</div>
              <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Check your email</div>
              <div style={{fontSize:13,color:'#6b7280',marginBottom:16}}>We sent a verification link to <strong>{form.email}</strong>.</div>
              <button onClick={()=>setMode('login')} style={{...btnPrimary,width:'auto',padding:'8px 20px'}}>Back to login</button>
            </div>
          )}
          {msg && mode === 'apply' && (
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>✅</div>
              <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Application received</div>
              <div style={{fontSize:13,color:'#6b7280',marginBottom:16}}>{msg}</div>
              <button onClick={()=>{setMode('login');setMsg(null)}} style={{...btnPrimary,width:'auto',padding:'8px 20px'}}>Back to login</button>
            </div>
          )}
          {mode === 'login' && !msg && (
            <>
              <div style={{fontSize:18,fontWeight:700,marginBottom:20}}>Sign in to your account</div>
              <button onClick={handleGoogleLogin} style={btnGoogle}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Continue with Google
              </button>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                <div style={{flex:1,height:1,background:'#e5e7eb'}}/><span style={{fontSize:12,color:'#9ca3af'}}>or</span><div style={{flex:1,height:1,background:'#e5e7eb'}}/>
              </div>
              <form onSubmit={handleLogin}>
                <label style={S.lbl}>Email</label>
                <input style={inputStyle} type="email" required placeholder="you@institution.ac.uk" value={form.email} onChange={e=>set('email',e.target.value)}/>
                <label style={S.lbl}>Password</label>
                <input style={inputStyle} type="password" required placeholder="••••••••" value={form.password} onChange={e=>set('password',e.target.value)}/>
                {err&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'8px 12px',color:'#991b1b',fontSize:13,marginBottom:12}}>{err}</div>}
                <button type="submit" disabled={busy} style={btnPrimary}>{busy?'Signing in…':'Sign in'}</button>
              </form>
              <div style={{textAlign:'center',fontSize:13,color:'#6b7280'}}>
                No account? <span onClick={()=>{setMode('signup');setErr(null)}} style={{color:'#1d4ed8',cursor:'pointer',fontWeight:600}}>Create one</span>
              </div>
            </>
          )}
          {mode === 'signup' && !msg && (
            <>
              <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>Create your account</div>
              <div style={{fontSize:12,color:'#6b7280',marginBottom:16}}>NHS and university emails get instant access.</div>
              <button onClick={handleGoogleLogin} style={btnGoogle}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Sign up with Google
              </button>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                <div style={{flex:1,height:1,background:'#e5e7eb'}}/><span style={{fontSize:12,color:'#9ca3af'}}>or</span><div style={{flex:1,height:1,background:'#e5e7eb'}}/>
              </div>
              <form onSubmit={handleSignup}>
                <label style={S.lbl}>Full name</label>
                <input style={inputStyle} required placeholder="Dr. John Ohanebo" value={form.name} onChange={e=>set('name',e.target.value)}/>
                <label style={S.lbl}>Institution</label>
                <input style={inputStyle} required placeholder="University of Dundee" value={form.institution} onChange={e=>set('institution',e.target.value)}/>
                <label style={S.lbl}>Email</label>
                <input style={inputStyle} type="email" required placeholder="you@institution.ac.uk" value={form.email} onChange={e=>set('email',e.target.value)}/>
                {form.email && <div style={{fontSize:11,marginTop:-10,marginBottom:10,color:isInstitutional(form.email)?'#059669':'#d97706'}}>
                  {isInstitutional(form.email)?'✓ Institutional email — instant access':'⚠ Non-institutional email — requires approval'}
                </div>}
                <label style={S.lbl}>Password</label>
                <input style={inputStyle} type="password" required placeholder="Min 8 characters" value={form.password} onChange={e=>set('password',e.target.value)}/>
                {err&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'8px 12px',color:'#991b1b',fontSize:13,marginBottom:12}}>{err}</div>}
                <button type="submit" disabled={busy} style={btnPrimary}>{busy?'Creating account…':'Create account'}</button>
              </form>
              <div style={{textAlign:'center',fontSize:13,color:'#6b7280'}}>
                Already have an account? <span onClick={()=>{setMode('login');setErr(null)}} style={{color:'#1d4ed8',cursor:'pointer',fontWeight:600}}>Sign in</span>
              </div>
            </>
          )}
          {mode === 'apply' && !msg && (
            <>
              <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>Apply for access</div>
              <div style={{fontSize:12,color:'#6b7280',marginBottom:16}}>Tell us about your research. We review applications within 24 hours.</div>
              <form onSubmit={handleApply}>
                <label style={S.lbl}>Full name *</label>
                <input style={inputStyle} required placeholder="Dr. John Ohanebo" value={form.name} onChange={e=>set('name',e.target.value)}/>
                <label style={S.lbl}>Email *</label>
                <input style={inputStyle} type="email" required value={form.email} onChange={e=>set('email',e.target.value)}/>
                <label style={S.lbl}>Institution *</label>
                <input style={inputStyle} required placeholder="Independent researcher / Company / Hospital" value={form.institution} onChange={e=>set('institution',e.target.value)}/>
                <label style={S.lbl}>Your role *</label>
                <input style={inputStyle} required placeholder="e.g. Clinical researcher, Data scientist" value={form.role} onChange={e=>set('role',e.target.value)}/>
                <label style={S.lbl}>Research area *</label>
                <input style={inputStyle} required placeholder="e.g. Retinal imaging, Neuroscience" value={form.research_area} onChange={e=>set('research_area',e.target.value)}/>
                {err&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'8px 12px',color:'#991b1b',fontSize:13,marginBottom:12}}>{err}</div>}
                <button type="submit" disabled={busy} style={btnPrimary}>{busy?'Submitting…':'Submit application'}</button>
              </form>
              <div style={{textAlign:'center',fontSize:13,color:'#6b7280'}}>
                <span onClick={()=>{setMode('signup');setErr(null)}} style={{color:'#1d4ed8',cursor:'pointer'}}>← Back</span>
              </div>
            </>
          )}
        </div>
        <div style={{textAlign:'center',marginTop:16,fontSize:11,color:'#475569'}}>
          By signing in you agree to our research data governance framework.<br/>
          All activity is logged in an immutable audit trail.
        </div>
      </div>
    </div>
  )
}

// ── LAUNCH FORM ───────────────────────────────────────────────────────────────

function LaunchForm({ onLaunched, user, session, preselectedNodes = [] }) {
  const [file,setFile]=useState(null); const [drag,setDrag]=useState(false)
  const [busy,setBusy]=useState(false); const [err,setErr]=useState(null)
  const [preset,setPreset]=useState('standard')
  const [invitationMessage,setInvitationMessage]=useState('')
  const [form,setForm]=useState({
    study_name:'', researcher_name: user?.user_metadata?.full_name || '',
    institution: user?.user_metadata?.institution || '',
    dataset:'octmnist', architecture:'resnet18', num_rounds:5, local_epochs:2, dp_enabled:false, dp_epsilon:1.0
  })
  const ref=useRef(); const set=(k,v)=>setForm(f=>({...f,[k]:v}))
  const applyPreset=(p)=>{setPreset(p);const f=PRESETS.find(x=>x.v===p);if(f&&f.rounds){set('num_rounds',f.rounds);set('local_epochs',f.epochs)}}

  const hasRealNodes = preselectedNodes.length > 0
  const defaultNodes = [
    {node_id:'nhs-moorfields-sim',institution_name:'NHS Moorfields Eye Hospital (Simulated)',partition_id:0},
    {node_id:'uni-edinburgh-sim',institution_name:'University of Edinburgh (Simulated)',partition_id:1}
  ]

  const submit=async e=>{
    e.preventDefault();setBusy(true);setErr(null)
    try{
      const fd=new FormData()
      Object.entries(form).forEach(([k,v])=>fd.append(k,v))
      const nodes = hasRealNodes
        ? preselectedNodes.map((id, i) => ({node_id: id, institution_name: id, partition_id: i}))
        : defaultNodes
      fd.append('nodes', JSON.stringify(nodes))
      if(file)fd.append('file',file)
      if(form.dp_enabled){fd.append('dp_noise_multiplier', (1.0/form.dp_epsilon).toFixed(4))}
      if(hasRealNodes && invitationMessage) fd.append('invitation_message', invitationMessage)
      const r=await fetch(`${API}/studies`,{method:'POST',body:fd,headers:{Authorization:`Bearer ${session?.access_token}`}}).then(async res=>{if(!res.ok){throw new Error(await res.text())}return res.json()})
      onLaunched(r.study_id, hasRealNodes)
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }

  return(
    <form onSubmit={submit} style={{maxWidth:620}}>
      <h1 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Launch a federated study</h1>
      <p style={{fontSize:13,color:'#6b7280',marginBottom:20}}>Real federated training across institution nodes. Raw data never leaves its node — only model gradients are exchanged via FedAvg.</p>
      {hasRealNodes && (
        <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,padding:'14px 16px',marginBottom:16}}>
          <div style={{fontWeight:600,fontSize:13,color:'#92400e',marginBottom:8}}>📨 Invitations will be sent to {preselectedNodes.length} node{preselectedNodes.length>1?'s':''}</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
            {preselectedNodes.map(id=>(
              <span key={id} style={{background:'#fff',border:'1px solid #fde68a',color:'#78350f',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,fontFamily:'monospace'}}>{id}</span>
            ))}
          </div>
          <label style={{display:'block',fontSize:11,fontWeight:600,color:'#92400e',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.05em'}}>Message to node operators (optional)</label>
          <textarea
            value={invitationMessage}
            onChange={e=>setInvitationMessage(e.target.value)}
            placeholder="e.g. We are conducting a retinal imaging study and would like your institution's anonymised OCT scans to participate…"
            rows={3}
            style={{width:'100%',padding:'8px 10px',borderRadius:7,border:'1px solid #fde68a',fontSize:12,boxSizing:'border-box',resize:'vertical',fontFamily:'inherit',background:'#fffef7'}}
          />
          <div style={{fontSize:11,color:'#a16207',marginTop:6}}>Invitations are created when the study launches. Node operators can accept or decline from their dashboard.</div>
        </div>
      )}
      <div style={S.card}>
        <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:12}}>Study details</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><label style={S.lbl}>Study name *</label><input style={S.inp} required placeholder="Glaucoma Detection — UK Cohort" value={form.study_name} onChange={e=>set('study_name',e.target.value)}/></div>
          <div><label style={S.lbl}>Researcher name *</label><input style={S.inp} required placeholder="Dr. John Ohanebo" value={form.researcher_name} onChange={e=>set('researcher_name',e.target.value)}/></div>
        </div>
        <label style={S.lbl}>Institution *</label>
        <input style={{...S.inp,marginBottom:0}} required placeholder="University of Dundee" value={form.institution} onChange={e=>set('institution',e.target.value)}/>
      </div>
      <div style={S.card}>
        <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:12}}>Dataset</div>
        <select style={S.inp} value={form.dataset} onChange={e=>set('dataset',e.target.value)}>
          <optgroup label="Medical Imaging (MedMNIST)">
            {DATASETS.filter(d=>d.v!=='upload').map(d=><option key={d.v} value={d.v}>{d.l}</option>)}
          </optgroup>
          <optgroup label="Upload Your Own">
            <option value="upload">Upload custom dataset (NPZ, CSV, ZIP, DICOM)</option>
          </optgroup>
        </select>
        {form.dataset==='upload'&&(
          <div>
            <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)setFile(f)}}
              onClick={()=>ref.current.click()}
              style={{border:`2px dashed ${drag?'#1d4ed8':file?'#059669':'#d1d5db'}`,borderRadius:10,padding:'20px',textAlign:'center',cursor:'pointer',background:drag?'#eff6ff':file?'#f0fdf4':'#fafafa'}}>
              <div style={{fontSize:28,marginBottom:6}}>{file?'✅':'📂'}</div>
              <div style={{fontSize:13,fontWeight:600,color:file?'#059669':'#374151'}}>{file?file.name:'Drop file here or click to browse'}</div>
              <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>{file?`${(file.size/1024/1024).toFixed(2)} MB`:'NPZ · CSV · ZIP · DICOM · JPG · PNG'}</div>
              {file&&<button type="button" onClick={e=>{e.stopPropagation();setFile(null)}} style={{marginTop:8,fontSize:12,color:'#dc2626',background:'none',border:'none',cursor:'pointer'}}>Remove</button>}
            </div>
            <input ref={ref} type="file" style={{display:'none'}} onChange={e=>setFile(e.target.files[0])}/>
          </div>
        )}
      </div>
      <div style={S.card}>
        <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:12}}>AI Model Architecture</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {ARCHS.map(a=>(
            <div key={a.v} onClick={()=>set('architecture',a.v)}
              style={{border:`2px solid ${form.architecture===a.v?'#1d4ed8':'#e5e7eb'}`,borderRadius:8,padding:'10px 12px',cursor:'pointer',background:form.architecture===a.v?'#eff6ff':'#fff'}}>
              <div style={{fontWeight:600,fontSize:13,color:form.architecture===a.v?'#1d4ed8':'#374151'}}>{a.l}</div>
              <div style={{fontSize:11,color:'#9ca3af',marginTop:2}}>{a.sub}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={S.card}>
        <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:12}}>Training configuration</div>
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          {PRESETS.map(p=><button key={p.v} type="button" onClick={()=>applyPreset(p.v)}
            style={{padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:500,cursor:'pointer',border:'none',background:preset===p.v?'#1d4ed8':'#f3f4f6',color:preset===p.v?'#fff':'#6b7280'}}>{p.l}</button>)}
        </div>
        {preset==='custom'&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><label style={S.lbl}>FL rounds (1–20)</label><input style={S.inp} type="number" min={1} max={20} value={form.num_rounds} onChange={e=>set('num_rounds',+e.target.value)}/></div>
          <div><label style={S.lbl}>Local epochs/round</label><input style={S.inp} type="number" min={1} max={5} value={form.local_epochs} onChange={e=>set('local_epochs',+e.target.value)}/></div>
        </div>}
        {preset!=='custom'&&<div style={{fontSize:12,color:'#6b7280',background:'#f9fafb',borderRadius:8,padding:'8px 12px'}}>{form.num_rounds} rounds · {form.local_epochs} epoch{form.local_epochs>1?'s':''}/round</div>}
      </div>
      <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:12,color:'#0369a1'}}>
        🔒 <strong>Zero raw data transfer.</strong> Only model weight gradients are aggregated via FedAvg. Full governance audit trail generated automatically.
      </div>
      {err&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'9px 12px',color:'#991b1b',fontSize:13,marginBottom:12}}>{err}</div>}
      <button type="submit" disabled={busy} style={{width:'100%',padding:13,background:busy?'#93c5fd':'#1d4ed8',color:'#fff',borderRadius:8,fontWeight:700,fontSize:15,cursor:busy?'not-allowed':'pointer',border:'none'}}>
        {busy?'Launching…': hasRealNodes ? '🚀 Launch study & send invitations' : '🚀 Launch federated training'}
      </button>
    </form>
  )
}

// ── STUDY VIEW ────────────────────────────────────────────────────────────────

function StudyView({ studyId, onBack, session, isAdmin, initialTab = 'live' }) {
  const [job,setJob]=useState(null); const [audit,setAudit]=useState([])
  const [tab,setTab]=useState(initialTab)
  const [log,setLog]=useState([{ts:new Date().toLocaleTimeString(),msg:'Connecting to study…',type:'info'}])
  const logRef=useRef(null)
  useEffect(()=>{if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight},[log])
  const addLog=useCallback((msg,type='info')=>setLog(l=>[...l,{ts:new Date().toLocaleTimeString(),msg,type}].slice(-500)),[])
  useEffect(()=>{
    let prev={status:null,round:0,liveStatus:null}
    const poll=async()=>{
      try{
        const {data:{session:freshSession}}=await supabase.auth.getSession();const token=freshSession?.access_token||null;const data=await apiFetch(`/studies/${studyId}`,{},token)
        setJob(data)
        if(prev.status===null){addLog(`✅ Connected — ${data.study_name||data.name}`,'success');addLog(`   Dataset: ${data.dataset}  ·  Architecture: ${data.architecture||data.model}  ·  ${data.num_rounds||data.total_rounds} rounds`);if(data.data_description)addLog(`   Data: ${data.data_description}`)}
        if(data.live_status&&data.status==='running'&&data.live_status!==prev.liveStatus){addLog(`   ⏳ ${data.live_status}`,'info');prev.liveStatus=data.live_status}
        if(data.status==='running'&&prev.status!=='running')addLog(`⚡ Training started — FedAvg across ${data.nodes?.length||2} nodes`)
        const rounds=data.round_results||data.rounds||[]
        if(rounds.length>prev.round){
          for(let i=prev.round;i<rounds.length;i++){
            const r=rounds[i]
            addLog(`⚡ Round ${r.round||r.round_number}/${data.num_rounds||data.total_rounds} — aggregating…`)
            ;(Array.isArray(r.node_metrics) ? r.node_metrics : Object.values(r.node_metrics||{})).forEach(n=>{addLog(`   🏥 ${n.institution||n.node_id}`,'node');addLog(`      acc ${(n.accuracy*100).toFixed(1)}%  ·  loss ${n.loss?.toFixed(4)}  ·  ${n.num_examples||0} samples`,'node')})
            addLog(`✓ Round complete — global acc ${((r.global_accuracy||r.accuracy||0)*100).toFixed(1)}%`,'success')
          }
          prev.round=rounds.length
        }
        if(data.status==='completed'&&prev.status!=='completed'){addLog(`🎉 Done! Final accuracy: ${((data.final_accuracy||0)*100).toFixed(1)}%`,'success');apiFetch(`/studies/${studyId}/audit`).then(a=>setAudit(a.events)).catch(()=>{})}
        if((data.status==='cancelled'||data.status==='stopped')&&prev.status!==data.status)addLog(`🛑 Training stopped by user`,'error')
        if(data.status==='failed'&&prev.status!=='failed')addLog(`❌ Failed: ${data.error||data.error_message}`,'error')
        prev.status=data.status
      }catch(e){if(!e.message.includes('Token validation'))addLog(`⚠ Poll error: ${e.message}`,'error')}
    }
    if(!session?.access_token){setTimeout(poll,1000);return}
    poll()
    const id=setInterval(()=>{
      const terminal=job&&(job.status==='completed'||job.status==='cancelled'||job.status==='failed'||job.status==='stopped')
      if(terminal){if(!job.rounds?.length)poll();return}
      poll()
    },2000)
    return()=>clearInterval(id)
  },[studyId])
  const rounds = (job?.round_results?.length ? job.round_results : null) || job?.rounds || []
  const safeNodes = Array.isArray(job?.nodes) ? job.nodes : []
  const chart=rounds.map(r=>({round:`R${r.round||r.round_number}`,acc:+((r.global_accuracy||r.accuracy||0)*100).toFixed(2),loss:+(r.global_loss||r.loss||0).toFixed(4)}))
  const lastRound=rounds[rounds.length-1]
  const archInfo=ARCH_INFO[job?.architecture||job?.model]||{}
  const tabBtn=t=>({padding:'5px 14px',borderRadius:20,fontSize:12,fontWeight:500,cursor:'pointer',border:'none',background:tab===t?'#1d4ed8':'#f3f4f6',color:tab===t?'#fff':'#6b7280'})
  const logCol={info:'#374151',success:'#059669',error:'#dc2626',node:'#6d28d9'}
  const cancelStudy=async()=>{
    if(!confirm('Stop this training run?'))return
    try{await apiFetch(`/studies/${studyId}/cancel`,{method:'POST'});addLog('🛑 Stop requested','error')}
    catch(e){addLog(`Cancel failed: ${e.message}`,'error')}
  }
  const downloadModel=async()=>{
    try{
      const r=await fetch(`${API}/studies/${studyId}/download`,{headers:{Authorization:`Bearer ${session?.access_token}`}})
      if(!r.ok){
        let msg='Download failed'
        try{const d=await r.json();msg=d.detail||msg}catch{}
        addLog(`⬇ Download error: ${msg}`,'error')
        alert(`Download failed: ${msg}`)
        return
      }
      // If the response is a redirect (signed URL), fetch still follows it — we get the blob
      const blob=await r.blob()
      if(blob.size===0){alert('Downloaded file is empty — please try again');return}
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a');a.href=url;a.download=`undosatech_${job?.architecture||job?.model}_${studyId.slice(0,8)}.pt`;a.click();URL.revokeObjectURL(url)
      addLog('⬇ Model downloaded successfully','success')
    }catch(e){addLog(`⬇ Download error: ${e.message}`,'error');alert(`Download error: ${e.message}`)}
  }
  return(
    <div>
      <button onClick={onBack} style={{color:'#6b7280',fontSize:13,fontWeight:500,marginBottom:18,background:'none',border:'none',cursor:'pointer'}}>← All studies</button>
      {job?<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,flexWrap:'wrap',gap:10}}>
          <div>
            <h2 style={{fontSize:20,fontWeight:700,marginBottom:4}}>{job.study_name||job.name}</h2>
            <div style={{fontSize:12,color:'#9ca3af',marginBottom:8}}>{job.researcher_name||job.user_email} · {job.institution||''}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <Badge status={job.status}/>
              {(job.architecture||job.model)&&<span style={{background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{archInfo.name||job.architecture||job.model}</span>}
              {job.dataset&&<span style={{background:'#f5f3ff',color:'#5b21b6',border:'1px solid #ddd6fe',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{job.dataset}</span>}
              {archInfo.params&&<span style={{background:'#f9fafb',color:'#6b7280',border:'1px solid #e5e7eb',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{archInfo.params} params</span>}
              {job.dp_enabled&&<span style={{background:'#fef3c7',color:'#92400e',border:'1px solid #fde68a',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>🔒 DP enabled</span>}
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
            {job.final_accuracy!=null&&<div style={{textAlign:'right'}}><div style={{fontSize:36,fontWeight:800,color:'#059669',lineHeight:1}}>{(job.final_accuracy*100).toFixed(1)}%</div><div style={{fontSize:11,color:'#9ca3af'}}>final accuracy</div></div>}
            {job.status==='completed'&&<button onClick={downloadModel} style={{padding:'7px 14px',background:'#059669',color:'#fff',borderRadius:8,fontSize:12,fontWeight:600,border:'none',cursor:'pointer'}}>⬇ Download model</button>}
            {['running','pending'].includes(job.status)&&<button onClick={cancelStudy} style={{padding:'7px 14px',background:'#dc2626',color:'#fff',borderRadius:8,fontSize:12,fontWeight:600,border:'none',cursor:'pointer'}}>🛑 Stop training</button>}
          </div>
        </div>
        {job.status==='running'&&(job.num_rounds||job.total_rounds)>0&&(
          <div style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#6b7280',marginBottom:4}}><span>Round {job.current_round} of {job.num_rounds||job.total_rounds}</span><span>{Math.round(((job.current_round||0)/(job.num_rounds||job.total_rounds||1))*100)}%</span></div>
            <div style={{height:7,background:'#f3f4f6',borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:`${((job.current_round||0)/(job.num_rounds||job.total_rounds||1))*100}%`,background:'linear-gradient(90deg,#1d4ed8,#7c3aed)',borderRadius:4,transition:'width 0.6s ease'}}/></div>
          </div>
        )}
        {job.data_description&&<div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#065f46',marginBottom:14}}>📊 {job.data_description}</div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:10,marginBottom:16}}>
          <Stat label="Status" value={job.status}/>
          <Stat label="Rounds" value={`${job.current_round||0}/${job.num_rounds||job.total_rounds}`} color="#1d4ed8"/>
          {job.final_accuracy!=null&&<Stat label="Accuracy" value={`${(job.final_accuracy*100).toFixed(1)}%`} color="#059669"/>}
          {job.final_loss!=null&&<Stat label="Loss" value={job.final_loss?.toFixed(4)}/>}
          {job.num_classes&&<Stat label="Classes" value={job.num_classes}/>}
        </div>
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          {['live','chart','per-class','nodes','interpretability','audit','invitations'].map(t=><button key={t} style={tabBtn(t)} onClick={()=>setTab(t)}>{t}</button>)}
        </div>
        {tab==='live'&&<div style={S.card}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:10,display:'flex',justifyContent:'space-between'}}><span>Live training log</span><span style={{fontWeight:400,color:'#9ca3af'}}>{log.length} events · polling every 2s</span></div>
          <div ref={logRef} style={{fontFamily:'monospace',fontSize:12,maxHeight:400,overflowY:'auto',display:'flex',flexDirection:'column',gap:2}}>
            {log.map((l,i)=><div key={i} style={{display:'flex',gap:10}}><span style={{color:'#d1d5db',flexShrink:0}}>{l.ts}</span><span style={{color:logCol[l.type]||'#374151'}}>{l.msg}</span></div>)}
          </div>
        </div>}
        {tab==='chart'&&<div style={S.card}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>Global accuracy & loss per round</div>
          {chart.length===0?<div style={{color:'#9ca3af',fontSize:13}}>Updates as rounds complete…</div>:
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                <XAxis dataKey="round" tick={{fontSize:11,fill:'#9ca3af'}}/>
                <YAxis yAxisId="a" domain={[0,100]} tick={{fontSize:11,fill:'#9ca3af'}} unit="%"/>
                <YAxis yAxisId="l" orientation="right" tick={{fontSize:11,fill:'#9ca3af'}}/>
                <Tooltip formatter={(v,n)=>n==='acc'?`${v}%`:v}/>
                <Legend wrapperStyle={{fontSize:12}}/>
                <Line yAxisId="a" type="monotone" dataKey="acc" name="Accuracy" stroke="#1d4ed8" strokeWidth={2} dot={{r:4}} activeDot={{r:6}}/>
                <Line yAxisId="l" type="monotone" dataKey="loss" name="Loss" stroke="#dc2626" strokeWidth={2} dot={{r:4}} strokeDasharray="4 2"/>
              </LineChart>
            </ResponsiveContainer>}
        </div>}
        {tab==='per-class'&&<div style={S.card}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>Per-class accuracy (latest round)</div>
          {(lastRound?.per_class_accuracy || job?.per_class_accuracy)?(()=>{
            const rawPc = lastRound?.per_class_accuracy || job?.per_class_accuracy
            const pcData = Array.isArray(rawPc)
              ? rawPc
              : Object.values(rawPc)
            const labels=job.class_names||job.interpretability?.class_labels||pcData.map((_,i)=>`Class ${i}`)
            const data=pcData.map((acc,i)=>({name:labels[i]||`C${i}`,acc}))
            return<ResponsiveContainer width="100%" height={240}>
              <BarChart data={data} margin={{top:5,right:10,left:0,bottom:40}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                <XAxis dataKey="name" tick={{fontSize:10,fill:'#6b7280'}} angle={-35} textAnchor="end"/>
                <YAxis domain={[0,100]} tick={{fontSize:11,fill:'#9ca3af'}} unit="%"/>
                <Tooltip formatter={v=>`${v}%`}/>
                <Bar dataKey="acc" name="Accuracy" radius={[4,4,0,0]}>{data.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          })():<div style={{color:'#9ca3af',fontSize:13}}>Available after round 1.</div>}
        </div>}
        {tab==='nodes'&&<div>
          {(Array.isArray(lastRound?.node_metrics) ? lastRound.node_metrics : Object.values(lastRound?.node_metrics||{})).map(n=><div key={n.node_id} style={{...S.card,display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:42,height:42,borderRadius:'50%',background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🏥</div>
            <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{n.institution}</div><div style={{fontSize:12,color:'#9ca3af'}}>{n.num_examples} samples · lr {n.learning_rate}</div></div>
            <div style={{textAlign:'right'}}><div style={{fontWeight:700,color:'#1d4ed8',fontSize:17}}>{(n.accuracy*100).toFixed(1)}%</div><div style={{fontSize:11,color:'#9ca3af'}}>local acc</div></div>
            <span style={{background:'#ecfdf5',color:'#065f46',border:'1px solid #a7f3d0',padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:500}}>{n.governance_status}</span>
          </div>)||<div style={{...S.card,color:'#9ca3af',fontSize:13}}>Node metrics after round 1.</div>}
        </div>}
        {tab==='interpretability'&&<div style={S.card}>
          {job.interpretability?<>
            <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>{job.interpretability.method}</div>
            <div style={{fontSize:13,color:'#6b7280',marginBottom:14}}>{job.interpretability.summary}</div>
            {job.interpretability.class_labels?.length>0&&<div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:600,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Class labels</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{job.interpretability.class_labels.map((l,i)=><span key={i} style={{background:'#f5f3ff',color:'#5b21b6',border:'1px solid #ddd6fe',padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:500}}>{l}</span>)}</div>
            </div>}
            <div style={{fontSize:11,fontWeight:600,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:8}}>Feature importance</div>
            {job.interpretability.top_features.map((f,i)=><div key={i} style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3,fontSize:13}}><span>{f.feature}</span><span style={{fontWeight:600,color:f.direction==='positive'?'#059669':'#dc2626'}}>{f.direction==='positive'?'+':'−'}{(f.importance*100).toFixed(1)}%</span></div>
              <div style={{height:6,background:'#f3f4f6',borderRadius:3}}><div style={{height:'100%',width:`${f.importance*100}%`,background:f.direction==='positive'?'#1d4ed8':'#dc2626',borderRadius:3}}/></div>
            </div>)}
          </>:<div style={{color:'#9ca3af',fontSize:13}}>Available after training completes.</div>}
        </div>}
        {tab==='audit'&&<div style={S.card}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:10}}>Governance audit trail · {audit.length} events</div>
          <div style={{fontFamily:'monospace',fontSize:11,maxHeight:380,overflowY:'auto'}}>
            {audit.length===0?<span style={{color:'#9ca3af'}}>Available after training completes.</span>:
              audit.slice().reverse().map(e=><div key={e.event_id} style={{padding:'5px 0',borderBottom:'1px solid #f3f4f6',display:'flex',gap:10}}>
                <span style={{color:'#9ca3af',flexShrink:0}}>{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span style={{color:'#1d4ed8',flexShrink:0}}>{e.event_type}</span>
                {e.event_type==='round_completed'&&<span style={{color:'#374151'}}>round {e.round} · acc {(e.global_accuracy*100).toFixed(1)}%</span>}
                {e.event_type==='study_completed'&&<span style={{color:'#059669',fontWeight:600}}>final acc {(e.final_accuracy*100).toFixed(1)}%</span>}
              </div>)}
          </div>
        </div>}
        {tab==='invitations'&&<StudyInvitations studyId={studyId} session={session} isAdmin={isAdmin}/>}
      </>:<div style={{color:'#9ca3af',padding:40,textAlign:'center'}}>Loading study…</div>}
    </div>
  )
}

function StudiesList({ studies, onSelect }) {
  if(!studies.length)return<div style={{textAlign:'center',padding:'60px 20px',color:'#9ca3af'}}><div style={{fontSize:40,marginBottom:12}}>🔬</div><div style={{fontSize:16,fontWeight:600,color:'#374151',marginBottom:6}}>No studies yet</div><div style={{fontSize:13}}>Launch your first federated training study.</div></div>
  return<div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12}}>
    {studies.map((s,i)=><div key={s.study_id||s.id} onClick={()=>onSelect(s.study_id||s.id)}
      style={{display:'flex',alignItems:'center',gap:12,padding:'14px 20px',borderBottom:i<studies.length-1?'1px solid #f3f4f6':'none',cursor:'pointer'}}
      onMouseEnter={e=>e.currentTarget.style.background='#fafafa'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:13,marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.study_name||s.name}</div>
        <div style={{fontSize:11,color:'#9ca3af'}}>{s.researcher_name||s.user_email} · {s.dataset} · {ARCH_INFO[s.architecture||s.model]?.name||s.architecture||s.model} · {s.num_rounds||s.total_rounds} rounds</div>
      </div>
      {s.status==='running'&&<div style={{fontSize:12,color:'#7c3aed',fontWeight:600}}>R{s.current_round}/{s.num_rounds||s.total_rounds}</div>}
      {s.final_accuracy!=null&&<div style={{fontWeight:700,color:'#059669',fontSize:16}}>{(s.final_accuracy*100).toFixed(1)}%</div>}
      <Badge status={s.status}/><span style={{color:'#d1d5db'}}>›</span>
    </div>)}
  </div>
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(null)
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('launch')
  const [studies, setStudies] = useState([])
  const [selected,setSelected]= useState(null)
  const [online,  setOnline]  = useState(null)
  const [selectedNodes, setSelectedNodes] = useState([])
  const [studyInitialTab, setStudyInitialTab] = useState('live')

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setSession(session); setUser(session?.user||null); setLoading(false)
    })
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>{
      setSession(session); setUser(session?.user||null); setLoading(false)
    })
    return()=>subscription.unsubscribe()
  },[])

  const refresh=useCallback(async()=>{
    try{
      const headers = session?.access_token ? {'Authorization': `Bearer ${session.access_token}`} : {}
      const r = await fetch(`${API}/studies`, {headers})
      if(!r.ok) throw new Error()
      const d = await r.json()
      setStudies(Array.isArray(d) ? d : (d.studies || []))
      setOnline(true)
    }catch{setOnline(false)}
  },[session])

  useEffect(()=>{ if(user) refresh() },[user])
  useEffect(()=>{ const id=setInterval(()=>{ if(user) refresh() },3000); return()=>clearInterval(id) },[user,refresh])

  const signOut = async()=>{ await supabase.auth.signOut(); setSession(null); setUser(null) }

  if(loading) return <div style={{minHeight:'100vh',background:'#0f172a',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{color:'#94a3b8',fontSize:14}}>Loading…</div></div>
  if(!user) return <AuthScreen onAuth={(u,s)=>{setUser(u);setSession(s)}}/>

  const running=studies.filter(s=>s.status==='running').length
  const completed=studies.filter(s=>s.status==='completed').length
  const displayName=user.user_metadata?.full_name||user.email?.split('@')[0]||'Researcher'
  const isAdmin=ADMIN_EMAILS.includes(user.email||'')

  const nav=(t,label,badge)=><button onClick={()=>{setTab(t);if(t!=='studies')setSelected(null)}}
    style={{padding:'7px 16px',borderRadius:8,fontSize:13,fontWeight:tab===t?600:400,cursor:'pointer',border:'none',background:tab===t?'#1d4ed8':'transparent',color:tab===t?'#fff':'#9ca3af',display:'flex',alignItems:'center',gap:6}}>
    {label}{badge>0&&<span style={{background:'#7c3aed',color:'#fff',fontSize:10,padding:'1px 6px',borderRadius:10,fontWeight:700}}>{badge}</span>}
  </button>

  return<div style={{minHeight:'100vh',background:'#f9fafb'}}>
    <header style={{background:'#111827',padding:'0 24px',height:52,display:'flex',alignItems:'center',gap:14,position:'sticky',top:0,zIndex:10}}>
      <div style={{color:'#fff',fontWeight:700,fontSize:15,marginRight:8}}>UndosaTech <span style={{fontSize:10,fontWeight:400,color:'#6b7280'}}>Federated Research Platform</span></div>
      {nav('launch','🚀 Launch',0)}
      {nav('nodes','⬡ Nodes', selectedNodes.length)}
      {nav('studies','Studies',running)}
      {isAdmin&&nav('admin','⚙ Admin',0)}
      <div style={{marginLeft:'auto',display:'flex',gap:12,alignItems:'center',fontSize:12}}>
        {completed>0&&<span style={{color:'#34d399'}}>{completed} completed</span>}
        <span style={{color:online?'#34d399':'#f87171',display:'flex',alignItems:'center',gap:5}}>
          <span style={{width:6,height:6,borderRadius:'50%',background:online?'#34d399':'#f87171',display:'inline-block'}}/>
          {online===null?'Connecting…':online?'API online':'API offline'}
        </span>
        <div style={{display:'flex',alignItems:'center',gap:8,paddingLeft:12,borderLeft:'1px solid #374151'}}>
          <div style={{width:28,height:28,borderRadius:'50%',background:'#1d4ed8',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'#fff',fontWeight:700}}>
            {displayName[0].toUpperCase()}
          </div>
          <span style={{color:'#9ca3af',fontSize:12}}>{displayName}</span>
          <button onClick={signOut} style={{color:'#6b7280',fontSize:11,background:'none',border:'none',cursor:'pointer',padding:'2px 6px'}}>Sign out</button>
        </div>
      </div>
    </header>
    <div style={{maxWidth:820,width:'100%',margin:'0 auto',padding:'32px 20px'}}>
      {tab==='launch'&&!selected&&<LaunchForm onLaunched={(id,hadInvitations)=>{setSelected(id);setTab('studies');setStudyInitialTab(hadInvitations?'invitations':'live');refresh()}} user={user} session={session} preselectedNodes={selectedNodes}/>}
      {tab==='nodes'&&(
        <NodeRegistry
          session={session}
          isAdmin={isAdmin}
          selectedNodes={selectedNodes}
          onSelectionChange={setSelectedNodes}
          onLaunchWithNodes={() => setTab('launch')}
        />
      )}
      {tab==='studies'&&!selected&&<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h1 style={{fontSize:22,fontWeight:700}}>Studies</h1>
          <div style={{fontSize:13,color:'#9ca3af'}}>{running>0&&<span style={{color:'#7c3aed',fontWeight:600,marginRight:12}}>⚡ {running} running</span>}{studies.length} total</div>
        </div>
        <StudiesList studies={studies} onSelect={id=>{setSelected(id);setStudyInitialTab('live')}}/>
      </>}
      {tab==='studies'&&selected&&<StudyView studyId={selected} onBack={()=>{setSelected(null);setStudyInitialTab('live')}} session={session} isAdmin={isAdmin} initialTab={studyInitialTab}/>}
      {tab==='admin'&&isAdmin&&<AdminDashboard session={session}/>}
    </div>
    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}} *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#f9fafb;color:#111827;font-size:14px;-webkit-font-smoothing:antialiased} input,select,button,textarea{font-family:inherit} ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-thumb{background:#e5e7eb;border-radius:3px}`}</style>
  </div>
}
