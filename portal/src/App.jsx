import React, { useEffect, useState, useRef, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell } from 'recharts'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
async function apiFetch(path, opts={}) {
  const r = await fetch(`${API}${path}`, opts)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
const S = {
  card: { background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 22px', marginBottom:14 },
  inp:  { width:'100%', padding:'9px 12px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:14, outline:'none', marginBottom:12, color:'#111', background:'#fff', fontFamily:'inherit' },
  lbl:  { display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 },
}
const ARCH_INFO = {
  resnet18:       { name:'ResNet-18',       params:'11M', speed:'Fast'    },
  resnet50:       { name:'ResNet-50',       params:'25M', speed:'Medium'  },
  resnet101:      { name:'ResNet-101',      params:'44M', speed:'Slow'    },
  efficientnet_b0:{ name:'EfficientNet-B0', params:'5M',  speed:'Fast'    },
  efficientnet_b4:{ name:'EfficientNet-B4', params:'19M', speed:'Medium'  },
  vit_b16:        { name:'ViT-B/16',        params:'86M', speed:'Slow'    },
  cnn:            { name:'Lightweight CNN', params:'0.5M',speed:'Fastest' },
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
function Badge({ status }) {
  const m = {pending:['#f3f4f6','#374151','#e5e7eb'],running:['#f5f3ff','#6d28d9','#ddd6fe'],completed:['#ecfdf5','#065f46','#a7f3d0'],failed:['#fef2f2','#991b1b','#fecaca'],cancelling:['#fff7ed','#c2410c','#fed7aa'],cancelled:['#f3f4f6','#374151','#e5e7eb']}
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
function LaunchForm({ onLaunched }) {
  const [file,setFile]=useState(null); const [drag,setDrag]=useState(false)
  const [busy,setBusy]=useState(false); const [err,setErr]=useState(null)
  const [preset,setPreset]=useState('standard')
  const [form,setForm]=useState({study_name:'',researcher_name:'',institution:'',dataset:'octmnist',architecture:'resnet18',num_rounds:5,local_epochs:2})
  const ref=useRef(); const set=(k,v)=>setForm(f=>({...f,[k]:v}))
  const applyPreset=(p)=>{setPreset(p);const f=PRESETS.find(x=>x.v===p);if(f&&f.rounds){set('num_rounds',f.rounds);set('local_epochs',f.epochs)}}
  const submit=async e=>{
    e.preventDefault();setBusy(true);setErr(null)
    try{
      const fd=new FormData()
      Object.entries(form).forEach(([k,v])=>fd.append(k,v))
      fd.append('nodes',JSON.stringify([{node_id:'moorfields-001',institution_name:'NHS Moorfields Eye Hospital',partition_id:0},{node_id:'edinburgh-001',institution_name:'University of Edinburgh Medical School',partition_id:1}]))
      if(file)fd.append('file',file)
      const r=await apiFetch('/studies',{method:'POST',body:fd})
      onLaunched(r.study_id)
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  return(
    <form onSubmit={submit} style={{maxWidth:620}}>
      <h1 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Launch a federated study</h1>
      <p style={{fontSize:13,color:'#6b7280',marginBottom:20}}>Real federated training across NHS institution nodes. Raw data never leaves its node — only model gradients are exchanged via FedAvg.</p>
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
            <div style={{marginTop:6,fontSize:11,color:'#9ca3af'}}>CSV: last column = label. ZIP: subfolders by class. NPZ: keys[0]=images, keys[1]=labels.</div>
          </div>
        )}
      </div>
      <div style={S.card}>
        <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:12}}>AI Model Architecture</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {ARCHS.map(a=>(
            <div key={a.v} onClick={()=>set('architecture',a.v)}
              style={{border:`2px solid ${form.architecture===a.v?'#1d4ed8':'#e5e7eb'}`,borderRadius:8,padding:'10px 12px',cursor:'pointer',background:form.architecture===a.v?'#eff6ff':'#fff',transition:'all 0.1s'}}>
              <div style={{fontWeight:600,fontSize:13,color:form.architecture===a.v?'#1d4ed8':'#374151'}}>{a.l}</div>
              <div style={{fontSize:11,color:'#9ca3af',marginTop:2}}>{a.sub}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={S.card}>
        <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:12}}>Training configuration</div>
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          {PRESETS.map(p=>(
            <button key={p.v} type="button" onClick={()=>applyPreset(p.v)}
              style={{padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:500,cursor:'pointer',border:'none',background:preset===p.v?'#1d4ed8':'#f3f4f6',color:preset===p.v?'#fff':'#6b7280'}}>
              {p.l}
            </button>
          ))}
        </div>
        {preset==='custom'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div><label style={S.lbl}>FL rounds (1–20)</label><input style={S.inp} type="number" min={1} max={20} value={form.num_rounds} onChange={e=>set('num_rounds',+e.target.value)}/></div>
            <div><label style={S.lbl}>Local epochs/round</label><input style={S.inp} type="number" min={1} max={5} value={form.local_epochs} onChange={e=>set('local_epochs',+e.target.value)}/></div>
          </div>
        )}
        {preset!=='custom'&&<div style={{fontSize:12,color:'#6b7280',background:'#f9fafb',borderRadius:8,padding:'8px 12px'}}>{form.num_rounds} rounds · {form.local_epochs} epoch{form.local_epochs>1?'s':''}/round</div>}
      </div>
      <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:12,color:'#0369a1'}}>
        🔒 <strong>Zero raw data transfer.</strong> Only model weight gradients are aggregated via FedAvg. Full governance audit trail generated.
      </div>
      {err&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'9px 12px',color:'#991b1b',fontSize:13,marginBottom:12}}>{err}</div>}
      <button type="submit" disabled={busy} style={{width:'100%',padding:13,background:busy?'#93c5fd':'#1d4ed8',color:'#fff',borderRadius:8,fontWeight:700,fontSize:15,cursor:busy?'not-allowed':'pointer',border:'none'}}>
        {busy?'Dispatching to nodes…':'🚀 Launch federated training'}
      </button>
    </form>
  )
}
function StudyView({ studyId, onBack }) {
  const [job,setJob]=useState(null); const [audit,setAudit]=useState([])
  const [tab,setTab]=useState('live')
  const [log,setLog]=useState([{ts:new Date().toLocaleTimeString(),msg:'Connecting to study…',type:'info'}])
  const logRef=useRef(null)
  useEffect(()=>{if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight},[log])
  const addLog=useCallback((msg,type='info')=>setLog(l=>[...l,{ts:new Date().toLocaleTimeString(),msg,type}].slice(-500)),[])
  useEffect(()=>{
    let prev={status:null,round:0}
    const poll=async()=>{
      try{
        const data=await apiFetch(`/studies/${studyId}`)
        setJob(data)
        if(prev.status===null){addLog(`✅ Connected — ${data.study_name}`,'success');addLog(`   Dataset: ${data.dataset}  ·  Architecture: ${data.architecture}  ·  ${data.num_rounds} rounds`);if(data.data_description)addLog(`   Data: ${data.data_description}`)}
        if(data.live_status&&data.status==='running'){addLog('   ⏳ '+data.live_status,'info')}
        if(data.status==='running'&&prev.status!=='running')addLog(`⚡ Training started — FedAvg across ${data.nodes?.length||2} nodes`)
        const rounds=data.round_results||[]
        if(rounds.length>prev.round){
          for(let i=prev.round;i<rounds.length;i++){
            const r=rounds[i]
            addLog(`⚡ Round ${r.round}/${data.num_rounds} — distributing global model…`)
            r.node_metrics?.forEach(n=>{addLog(`   🏥 ${n.institution}`,'node');addLog(`      acc ${(n.accuracy*100).toFixed(1)}%  ·  loss ${n.loss.toFixed(4)}  ·  ${n.num_examples} samples`,'node')})
            addLog(`✓ Round ${r.round} complete — global acc ${(r.global_accuracy*100).toFixed(1)}%  ·  loss ${r.global_loss.toFixed(4)}`,'success')
          }
          prev.round=rounds.length
        }
        if(data.status==='completed'&&prev.status!=='completed'){addLog(`🎉 Done! Final accuracy: ${(data.final_accuracy*100).toFixed(1)}%`,'success');apiFetch(`/studies/${studyId}/audit`).then(a=>setAudit(a.events)).catch(()=>{})}
        if(data.status==='failed'&&prev.status!=='failed')addLog(`❌ Failed: ${data.error}`,'error')
        prev.status=data.status
      }catch(e){addLog(`⚠ Poll error: ${e.message}`,'error')}
    }
    poll();const id=setInterval(()=>{if(job?.status==='completed'||job?.status==='failed')return;poll()},2000);return()=>clearInterval(id)
  },[studyId])
  const chart=(job?.round_results||[]).map(r=>({round:`R${r.round}`,acc:+(r.global_accuracy*100).toFixed(2),loss:+r.global_loss.toFixed(4)}))
  const lastRound=job?.round_results?.[job.round_results.length-1]
  const archInfo=ARCH_INFO[job?.architecture]||{}
  const tabBtn=t=>({padding:'5px 14px',borderRadius:20,fontSize:12,fontWeight:500,cursor:'pointer',border:'none',background:tab===t?'#1d4ed8':'#f3f4f6',color:tab===t?'#fff':'#6b7280'})
  const logCol={info:'#374151',success:'#059669',error:'#dc2626',node:'#6d28d9'}
  const COLORS=['#1d4ed8','#059669','#7c3aed','#d97706','#dc2626','#0891b2','#65a30d','#9333ea','#f59e0b','#10b981','#6366f1','#ef4444','#14b8a6','#f97316']
  const cancelStudy=async()=>{
    try{
      await apiFetch(`/studies/${studyId}/cancel`,{method:'POST'})
      addLog('🛑 Cancellation requested — stopping after current batch','error')
    }catch(e){addLog(`Cancel failed: ${e.message}`,'error')}
  }
  const downloadModel=async()=>{
    const r=await fetch(`${API}/studies/${studyId}/download`)
    if(!r.ok)return alert('Model not ready yet')
    const blob=await r.blob();const url=URL.createObjectURL(blob)
    const a=document.createElement('a');a.href=url;a.download=`undosatech_${job?.architecture}_${studyId.slice(0,8)}.pt`;a.click();URL.revokeObjectURL(url)
  }
  return(
    <div>
      <button onClick={onBack} style={{color:'#6b7280',fontSize:13,fontWeight:500,marginBottom:18,background:'none',border:'none',cursor:'pointer'}}>← All studies</button>
      {job?<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,flexWrap:'wrap',gap:10}}>
          <div>
            <h2 style={{fontSize:20,fontWeight:700,marginBottom:4}}>{job.study_name}</h2>
            <div style={{fontSize:12,color:'#9ca3af',marginBottom:8}}>{job.researcher_name} · {job.institution}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <Badge status={job.status}/>
              {job.architecture&&<span style={{background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{archInfo.name||job.architecture}</span>}
              {job.dataset&&<span style={{background:'#f5f3ff',color:'#5b21b6',border:'1px solid #ddd6fe',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{job.dataset}</span>}
              {archInfo.params&&<span style={{background:'#f9fafb',color:'#6b7280',border:'1px solid #e5e7eb',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{archInfo.params} params</span>}
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
            {job.final_accuracy!=null&&<div style={{textAlign:'right'}}><div style={{fontSize:36,fontWeight:800,color:'#059669',lineHeight:1}}>{(job.final_accuracy*100).toFixed(1)}%</div><div style={{fontSize:11,color:'#9ca3af'}}>final accuracy</div></div>}
            {job.status==='completed'&&<button onClick={downloadModel} style={{padding:'7px 14px',background:'#059669',color:'#fff',borderRadius:8,fontSize:12,fontWeight:600,border:'none',cursor:'pointer'}}>⬇ Download model weights</button>}
            {(job.status==='running'||job.status==='pending')&&<button onClick={cancelStudy} style={{padding:'7px 14px',background:'#dc2626',color:'#fff',borderRadius:8,fontSize:12,fontWeight:600,border:'none',cursor:'pointer'}}>🛑 Stop training</button>}
          </div>
        </div>
        {job.status==='running'&&job.num_rounds>0&&(
          <div style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#6b7280',marginBottom:4}}><span>Round {job.current_round} of {job.num_rounds}</span><span>{Math.round(((job.current_round||0)/job.num_rounds)*100)}%</span></div>
            <div style={{height:7,background:'#f3f4f6',borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:`${((job.current_round||0)/job.num_rounds)*100}%`,background:'linear-gradient(90deg,#1d4ed8,#7c3aed)',borderRadius:4,transition:'width 0.6s ease'}}/></div>
          </div>
        )}
        {job.data_description&&<div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#065f46',marginBottom:14}}>📊 {job.data_description}</div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:10,marginBottom:16}}>
          <Stat label="Status" value={job.status}/>
          <Stat label="Rounds" value={`${job.current_round||0}/${job.num_rounds}`} color="#1d4ed8"/>
          {job.final_accuracy!=null&&<Stat label="Accuracy" value={`${(job.final_accuracy*100).toFixed(1)}%`} color="#059669"/>}
          {job.final_loss!=null&&<Stat label="Loss" value={job.final_loss?.toFixed(4)}/>}
          {job.num_classes&&<Stat label="Classes" value={job.num_classes}/>}
        </div>
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          {['live','chart','per-class','nodes','interpretability','audit'].map(t=><button key={t} style={tabBtn(t)} onClick={()=>setTab(t)}>{t}</button>)}
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
          {lastRound?.per_class_accuracy?(()=>{
            const labels=job.class_names||job.interpretability?.class_labels||lastRound.per_class_accuracy.map((_,i)=>`Class ${i}`)
            const data=lastRound.per_class_accuracy.map((acc,i)=>({name:labels[i]||`C${i}`,acc}))
            return<ResponsiveContainer width="100%" height={240}>
              <BarChart data={data} margin={{top:5,right:10,left:0,bottom:40}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                <XAxis dataKey="name" tick={{fontSize:10,fill:'#6b7280'}} angle={-35} textAnchor="end"/>
                <YAxis domain={[0,100]} tick={{fontSize:11,fill:'#9ca3af'}} unit="%"/>
                <Tooltip formatter={v=>`${v}%`}/>
                <Bar dataKey="acc" name="Accuracy" radius={[4,4,0,0]}>
                  {data.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          })():<div style={{color:'#9ca3af',fontSize:13}}>Available after round 1.</div>}
        </div>}
        {tab==='nodes'&&<div>
          {lastRound?.node_metrics?.map(n=><div key={n.node_id} style={{...S.card,display:'flex',alignItems:'center',gap:14}}>
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
      </>:<div style={{color:'#9ca3af',padding:40,textAlign:'center'}}>Loading study…</div>}
    </div>
  )
}
function StudiesList({ studies, onSelect }) {
  if(!studies.length)return<div style={{textAlign:'center',padding:'60px 20px',color:'#9ca3af'}}><div style={{fontSize:40,marginBottom:12}}>🔬</div><div style={{fontSize:16,fontWeight:600,color:'#374151',marginBottom:6}}>No studies yet</div><div style={{fontSize:13}}>Launch your first federated training study.</div></div>
  return<div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12}}>
    {studies.map((s,i)=><div key={s.study_id} onClick={()=>onSelect(s.study_id)}
      style={{display:'flex',alignItems:'center',gap:12,padding:'14px 20px',borderBottom:i<studies.length-1?'1px solid #f3f4f6':'none',cursor:'pointer'}}
      onMouseEnter={e=>e.currentTarget.style.background='#fafafa'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:13,marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.study_name}</div>
        <div style={{fontSize:11,color:'#9ca3af'}}>{s.researcher_name} · {s.dataset} · {ARCH_INFO[s.architecture]?.name||s.architecture} · {s.num_rounds} rounds</div>
      </div>
      {s.status==='running'&&<div style={{fontSize:12,color:'#7c3aed',fontWeight:600}}>R{s.current_round}/{s.num_rounds}</div>}
      {s.final_accuracy!=null&&<div style={{fontWeight:700,color:'#059669',fontSize:16}}>{(s.final_accuracy*100).toFixed(1)}%</div>}
      <Badge status={s.status}/><span style={{color:'#d1d5db'}}>›</span>
    </div>)}
  </div>
}
export default function App() {
  const [tab,setTab]=useState('launch'); const [studies,setStudies]=useState([])
  const [selected,setSelected]=useState(null); const [online,setOnline]=useState(null)
  const refresh=useCallback(async()=>{try{const d=await apiFetch('/studies');setStudies(d);setOnline(true)}catch{setOnline(false)}},[])
  useEffect(()=>{refresh()},[]);useEffect(()=>{const id=setInterval(refresh,3000);return()=>clearInterval(id)},[refresh])
  const running=studies.filter(s=>s.status==='running').length
  const completed=studies.filter(s=>s.status==='completed').length
  const nav=(t,label,badge)=><button onClick={()=>{setTab(t);if(t!=='studies')setSelected(null)}}
    style={{padding:'7px 16px',borderRadius:8,fontSize:13,fontWeight:tab===t?600:400,cursor:'pointer',border:'none',background:tab===t?'#1d4ed8':'transparent',color:tab===t?'#fff':'#9ca3af',display:'flex',alignItems:'center',gap:6}}>
    {label}{badge>0&&<span style={{background:'#7c3aed',color:'#fff',fontSize:10,padding:'1px 6px',borderRadius:10,fontWeight:700}}>{badge}</span>}
  </button>
  return<div style={{minHeight:'100vh',background:'#f9fafb'}}>
    <header style={{background:'#111827',padding:'0 24px',height:52,display:'flex',alignItems:'center',gap:14,position:'sticky',top:0,zIndex:10}}>
      <div style={{color:'#fff',fontWeight:700,fontSize:15,marginRight:8}}>UndosaTech <span style={{fontSize:10,fontWeight:400,color:'#6b7280'}}>Federated Research Platform</span></div>
      {nav('launch','🚀 Launch',0)}{nav('studies','Studies',running)}
      <div style={{marginLeft:'auto',display:'flex',gap:16,alignItems:'center',fontSize:12}}>
        {completed>0&&<span style={{color:'#34d399'}}>{completed} completed</span>}
        <span style={{color:online?'#34d399':'#f87171',display:'flex',alignItems:'center',gap:5}}>
          <span style={{width:6,height:6,borderRadius:'50%',background:online?'#34d399':'#f87171',display:'inline-block'}}/>
          {online===null?'Connecting…':online?'API online':'API offline'}
        </span>
      </div>
    </header>
    <div style={{maxWidth:820,width:'100%',margin:'0 auto',padding:'32px 20px'}}>
      {tab==='launch'&&!selected&&<LaunchForm onLaunched={id=>{setSelected(id);setTab('studies');refresh()}}/>}
      {tab==='studies'&&!selected&&<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h1 style={{fontSize:22,fontWeight:700}}>Studies</h1>
          <div style={{fontSize:13,color:'#9ca3af'}}>{running>0&&<span style={{color:'#7c3aed',fontWeight:600,marginRight:12}}>⚡ {running} running</span>}{studies.length} total</div>
        </div>
        <StudiesList studies={studies} onSelect={id=>setSelected(id)}/>
      </>}
      {tab==='studies'&&selected&&<StudyView studyId={selected} onBack={()=>setSelected(null)}/>}
    </div>
    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}} *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#f9fafb;color:#111827;font-size:14px;-webkit-font-smoothing:antialiased} input,select,button,textarea{font-family:inherit} ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-thumb{background:#e5e7eb;border-radius:3px}`}</style>
  </div>
}
