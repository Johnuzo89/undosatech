// portal/src/components/StudyReport.jsx
import { useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend,
} from 'recharts'

// ── Dataset registry ──────────────────────────────────────────────────────────
const DS = {
  octmnist: {
    full: 'OCT-MNIST (Optical Coherence Tomography)',
    domain: 'Ophthalmology',
    task: 'Retinal OCT scan classification',
    baseline: { resnet18: 0.761, resnet50: 0.772, efficientnet_b0: 0.789 },
    classes: {
      CNV:    { name: 'Choroidal Neovascularisation', risk: 'critical', note: 'Wet AMD — requires urgent anti-VEGF; misclassification risks blindness' },
      DME:    { name: 'Diabetic Macular Oedema',      risk: 'critical', note: 'Vision-threatening diabetic complication; delays worsen prognosis' },
      DRUSEN: { name: 'Drusen (Early/Dry AMD)',        risk: 'moderate', note: 'Precursor to advanced AMD; monitor for conversion to wet form' },
      NORMAL: { name: 'Normal Retina',                 risk: 'low',      note: 'No detectable pathology' },
    },
  },
  pathmnist: {
    full: 'Path-MNIST (Colorectal Histopathology)',
    domain: 'Histopathology / Oncology',
    task: 'Colorectal tissue patch classification',
    baseline: { resnet18: 0.954, resnet50: 0.961 },
    classes: {
      TUM:  { name: 'Colorectal Adenocarcinoma', risk: 'critical', note: 'Malignant epithelium — primary diagnostic target' },
      STR:  { name: 'Cancer-Associated Stroma',  risk: 'high',     note: 'Desmoplastic stroma; marker of tumour invasion' },
      LYM:  { name: 'Lymphocytic Infiltrate',    risk: 'moderate', note: 'Immune response indicator; affects prognosis scoring' },
      MUS:  { name: 'Smooth Muscle',             risk: 'low',      note: 'Muscularis layer; structural tissue' },
      NORM: { name: 'Normal Colon Mucosa',       risk: 'low',      note: 'Healthy epithelium' },
      ADI:  { name: 'Adipose Tissue',            risk: 'low',      note: 'Normal fat tissue' },
      MUC:  { name: 'Mucus',                     risk: 'low',      note: 'Mucosal secretion' },
      DEB:  { name: 'Debris',                    risk: 'low',      note: 'Non-cellular material' },
      BACK: { name: 'Background',                risk: 'low',      note: 'Non-tissue slide area' },
    },
  },
  chestmnist: {
    full: 'Chest-MNIST (NIH Chest X-Ray)',
    domain: 'Radiology / Pulmonology',
    task: 'Multi-label chest pathology detection',
    baseline: { resnet18: 0.941, resnet50: 0.947 },
    classes: {
      Pneumothorax:  { name: 'Pneumothorax',        risk: 'critical', note: 'Collapsed lung — emergency; false negative is life-threatening' },
      Mass:          { name: 'Pulmonary Mass',       risk: 'critical', note: 'Suspected lung malignancy; requires urgent CT and biopsy' },
      Nodule:        { name: 'Pulmonary Nodule',     risk: 'high',     note: 'Potential early malignancy; missed detection delays treatment' },
      Cardiomegaly:  { name: 'Cardiomegaly',         risk: 'high',     note: 'Enlarged heart; cardiac disease marker' },
      Effusion:      { name: 'Pleural Effusion',     risk: 'high',     note: 'Fluid in pleural space; may indicate malignancy or heart failure' },
      Edema:         { name: 'Pulmonary Oedema',     risk: 'high',     note: 'Fluid in lung tissue; heart failure indicator' },
      Pneumonia:     { name: 'Pneumonia',            risk: 'high',     note: 'Lung infection; early detection reduces mortality' },
      Atelectasis:   { name: 'Atelectasis',          risk: 'moderate', note: 'Partial lung collapse; may indicate obstruction' },
      Infiltration:  { name: 'Infiltration',         risk: 'moderate', note: 'Airspace opacification; infection or inflammation' },
      Consolidation: { name: 'Consolidation',        risk: 'moderate', note: 'Airspace consolidation; possible infection' },
      Emphysema:     { name: 'Emphysema',            risk: 'moderate', note: 'Chronic lung destruction; irreversible' },
      Fibrosis:      { name: 'Fibrosis',             risk: 'moderate', note: 'Lung scarring; progressive in ILD' },
      Pleural:       { name: 'Pleural Thickening',   risk: 'low',      note: 'Thickened pleural lining' },
      Hernia:        { name: 'Hiatal Hernia',        risk: 'low',      note: 'Diaphragmatic hernia; usually incidental' },
    },
  },
  dermamnist: {
    full: 'Derma-MNIST (HAM10000 Skin Lesion)',
    domain: 'Dermatology / Oncology',
    task: 'Dermoscopic skin lesion classification',
    baseline: { resnet18: 0.731, resnet50: 0.745 },
    classes: {
      MEL:  { name: 'Melanoma',            risk: 'critical', note: 'Malignant melanoma — highest mortality skin cancer; delay fatal' },
      BCC:  { name: 'Basal Cell Carcinoma',risk: 'high',     note: 'Most common skin cancer; locally destructive if untreated' },
      AK:   { name: 'Actinic Keratosis',   risk: 'moderate', note: 'Pre-cancerous lesion; ~10% progress to SCC' },
      NV:   { name: 'Melanocytic Naevus',  risk: 'low',      note: 'Common mole; benign, monitor for change' },
      BKL:  { name: 'Benign Keratosis',    risk: 'low',      note: 'Seborrhoeic keratosis; benign' },
      DF:   { name: 'Dermatofibroma',      risk: 'low',      note: 'Benign fibrous nodule' },
      VASC: { name: 'Vascular Lesion',     risk: 'low',      note: 'Angioma or vascular birthmark; benign' },
    },
  },
  breastmnist: {
    full: 'Breast-MNIST (Breast Ultrasound)',
    domain: 'Oncology / Radiology',
    task: 'Breast ultrasound lesion classification',
    baseline: { resnet18: 0.883, resnet50: 0.891 },
    classes: {
      Malignant: { name: 'Malignant Mass', risk: 'critical', note: 'Breast cancer — false negative has catastrophic consequences' },
      Benign:    { name: 'Benign Mass',    risk: 'low',      note: 'Non-cancerous tissue; confirm with follow-up' },
    },
  },
  bloodmnist: {
    full: 'Blood-MNIST (Peripheral Blood Cell)',
    domain: 'Haematology / Pathology',
    task: 'Microscopic blood cell classification',
    baseline: { resnet18: 0.962, resnet50: 0.971 },
    classes: {
      Ig:          { name: 'Immature Granulocyte', risk: 'high',     note: 'Left shift — infection, leukaemia, or bone marrow disorder' },
      Erythroblast:{ name: 'Erythroblast',         risk: 'moderate', note: 'Immature RBC; haemolytic anaemia or severe blood loss' },
      Basophil:    { name: 'Basophil',             risk: 'moderate', note: 'Allergic/inflammatory response; elevated in CML' },
      Eosinophil:  { name: 'Eosinophil',           risk: 'moderate', note: 'Parasitic infection or allergy marker' },
      Monocyte:    { name: 'Monocyte',             risk: 'low',      note: 'Innate immune phagocyte' },
      Neutrophil:  { name: 'Neutrophil',           risk: 'low',      note: 'Primary bacterial infection fighter' },
      Lymphocyte:  { name: 'Lymphocyte',           risk: 'low',      note: 'Adaptive immune cell' },
      Platelet:    { name: 'Platelet',             risk: 'low',      note: 'Thrombocyte; clotting function' },
    },
  },
  tissuemnist: {
    full: 'Tissue-MNIST (Kidney Cortex Microscopy)',
    domain: 'Renal Pathology',
    task: 'Kidney cortex tissue patch classification',
    baseline: { resnet18: 0.679, resnet50: 0.694 },
    classes: {
      'Colorectal adenocarcinoma epithelium': { name: 'Adenocarcinoma Epithelium', risk: 'critical', note: 'Malignant epithelium — primary target' },
      'Cancer-associated stroma':             { name: 'Tumour-Associated Stroma',  risk: 'high',     note: 'Desmoplastic stroma; invasion marker' },
      Lymphocytes:  { name: 'Lymphocytic Infiltrate', risk: 'moderate', note: 'Immune response; affects prognosis' },
      Mucus:        { name: 'Mucus',                  risk: 'low',      note: 'Mucosal secretion' },
      'Smooth muscle':       { name: 'Smooth Muscle',  risk: 'low', note: 'Vascular smooth muscle' },
      'Normal colon mucosa': { name: 'Normal Mucosa',  risk: 'low', note: 'Healthy kidney cortex' },
      Adipose:    { name: 'Adipose Tissue', risk: 'low', note: 'Fat cells' },
      Background: { name: 'Background',    risk: 'low', note: 'Non-tissue area' },
      Debris:     { name: 'Debris',        risk: 'low', note: 'Cellular debris' },
    },
  },
  retinamnist: {
    full: 'Retina-MNIST (Diabetic Retinopathy Grading)',
    domain: 'Ophthalmology / Diabetology',
    task: 'Fundus image diabetic retinopathy grading',
    baseline: { resnet18: 0.528, resnet50: 0.535 },
    classes: {
      'Grade 4': { name: 'Proliferative DR',   risk: 'critical', note: 'Advanced neovascularisation; high risk of blindness without laser treatment' },
      'Grade 3': { name: 'Severe Non-PDR',     risk: 'high',     note: 'Refer urgently; high risk of progression to PDR within 1 year' },
      'Grade 2': { name: 'Moderate Non-PDR',   risk: 'moderate', note: 'More than microaneurysms; 6-month review required' },
      'Grade 1': { name: 'Mild Non-PDR',       risk: 'low',      note: 'Microaneurysms only; annual review' },
      'Grade 0': { name: 'No Diabetic Retinopathy', risk: 'low', note: 'No DR detected; routine annual screening' },
    },
  },
  pneumoniamnist: {
    full: 'Pneumonia-MNIST (Paediatric Chest X-Ray)',
    domain: 'Radiology / Paediatrics',
    task: 'Pneumonia detection from chest radiograph',
    baseline: { resnet18: 0.845, resnet50: 0.862 },
    classes: {
      Pneumonia: { name: 'Pneumonia', risk: 'high', note: 'Bacterial or viral lung infection; early detection reduces mortality' },
      Normal:    { name: 'Normal',    risk: 'low',  note: 'No pneumonia detected' },
    },
  },
  organamnist: {
    full: 'OrganA-MNIST (Abdominal CT)',
    domain: 'Radiology / Anatomy',
    task: 'Abdominal organ localisation from CT',
    baseline: { resnet18: 0.954, resnet50: 0.963 },
    classes: {
      Liver:      { name: 'Liver',      risk: 'low', note: 'Hepatic organ' },
      'Kidney-L': { name: 'Left Kidney', risk: 'low', note: 'Left renal organ' },
      'Kidney-R': { name: 'Right Kidney',risk: 'low', note: 'Right renal organ' },
      Spleen:     { name: 'Spleen',      risk: 'low', note: 'Splenic organ' },
      Pancreas:   { name: 'Pancreas',    risk: 'low', note: 'Pancreatic organ' },
      Heart:      { name: 'Heart',       risk: 'low', note: 'Cardiac silhouette' },
      'Lung-L':   { name: 'Left Lung',   risk: 'low', note: 'Left pulmonary lobe' },
      'Lung-R':   { name: 'Right Lung',  risk: 'low', note: 'Right pulmonary lobe' },
      Bladder:    { name: 'Bladder',     risk: 'low', note: 'Urinary bladder' },
      'Femur-L':  { name: 'Left Femur',  risk: 'low', note: 'Left femoral head' },
      'Femur-R':  { name: 'Right Femur', risk: 'low', note: 'Right femoral head' },
    },
  },
}

const ARCH_NAMES = {
  resnet18: 'ResNet-18', resnet50: 'ResNet-50', resnet101: 'ResNet-101',
  efficientnet_b0: 'EfficientNet-B0', efficientnet_b4: 'EfficientNet-B4',
  vit_b_16: 'ViT-B/16', lightweight_cnn: 'Lightweight CNN',
}

const RISK_COLOR = { critical: '#dc2626', high: '#d97706', moderate: '#ca8a04', low: '#16a34a' }
const RISK_BG    = { critical: '#fef2f2', high: '#fffbeb', moderate: '#fefce8', low: '#f0fdf4' }

// ── Data helpers ──────────────────────────────────────────────────────────────
function normaliseRounds(job) {
  const raw = (job.rounds?.length > 0 ? job.rounds : job.round_results) || []
  return raw.map(r => ({
    round: r.round_number ?? r.round ?? 0,
    acc:   +((r.accuracy ?? r.global_accuracy ?? 0) * 100).toFixed(2),
    loss:  +(r.loss ?? r.global_loss ?? 0).toFixed(4),
  }))
}

function findConvergence(rounds, threshold = 0.3) {
  for (let i = 2; i < rounds.length; i++) {
    if (Math.abs(rounds[i].acc - rounds[i - 1].acc) < threshold) return rounds[i].round
  }
  return null
}

function getBaseline(dsKey, archKey) {
  const ds = DS[dsKey]
  if (!ds) return null
  const a = archKey.toLowerCase()
  if (a.includes('resnet18') || a.includes('resnet-18')) return ds.baseline?.resnet18
  if (a.includes('resnet50') || a.includes('resnet-50')) return ds.baseline?.resnet50
  if (a.includes('resnet101')) return ds.baseline?.resnet101
  if (a.includes('efficientnet_b0') || a.includes('efficientnet-b0')) return ds.baseline?.efficientnet_b0
  if (a.includes('efficientnet_b4') || a.includes('efficientnet-b4')) return ds.baseline?.efficientnet_b4
  return Object.values(ds.baseline || {})[0] ?? null
}

function classEntries(job, ds) {
  const raw = job.per_class_accuracy || {}
  const entries = Object.entries(raw).map(([k, v]) => {
    const info = ds?.classes?.[k] || { name: k, risk: 'low', note: '' }
    return { key: k, acc: +(v * 100).toFixed(1), ...info }
  })
  return entries.sort((a, b) => b.acc - a.acc)
}

function computeReport(job) {
  const dsKey  = (job.dataset || '').toLowerCase().replace(/-/g, '')
  const archKey = job.architecture || job.model || ''
  const ds      = DS[dsKey] || null
  const rounds  = normaliseRounds(job)
  const accuracy = job.final_accuracy ?? 0
  const baseline = getBaseline(dsKey, archKey)
  const vsBaseline = baseline ? accuracy - baseline : null
  const convergenceRound = findConvergence(rounds)
  const classes = classEntries(job, ds)
  const best  = classes[0]
  const worst = classes[classes.length - 1]
  const highRiskUnderperforming = classes.filter(
    c => (c.risk === 'critical' || c.risk === 'high') && c.acc < 80
  )
  const nodeCount = job.nodes?.length || 1

  // Mean accuracy gain per round (first half of training)
  const midpoint = Math.floor(rounds.length / 2)
  const earlyGain = rounds.length > 1
    ? ((rounds[midpoint]?.acc ?? 0) - (rounds[0]?.acc ?? 0)) / Math.max(midpoint, 1)
    : 0

  // Performance rating
  let rating, ratingColor
  if (vsBaseline === null) {
    rating = accuracy >= 0.90 ? 'Strong' : accuracy >= 0.75 ? 'Moderate' : 'Developing'
    ratingColor = accuracy >= 0.90 ? '#059669' : accuracy >= 0.75 ? '#d97706' : '#dc2626'
  } else {
    if (vsBaseline >= 0.02)        { rating = 'Exceeds published baseline'; ratingColor = '#059669' }
    else if (vsBaseline >= -0.02)  { rating = 'Matches published baseline';  ratingColor = '#1d4ed8' }
    else if (vsBaseline >= -0.08)  { rating = 'Below published baseline';    ratingColor = '#d97706' }
    else                           { rating = 'Significantly below baseline'; ratingColor = '#dc2626' }
  }

  // Recommendations
  const recs = []
  if (highRiskUnderperforming.length > 0) {
    recs.push(`Prioritise additional training data for ${highRiskUnderperforming.map(c => c.name).join(', ')} — these are high-risk classes performing below 80% and carry the greatest clinical impact if misclassified.`)
  }
  if (vsBaseline !== null && vsBaseline < -0.05) {
    recs.push(`Federated accuracy is ${Math.abs(vsBaseline * 100).toFixed(1)}% below the centralised benchmark. Consider increasing local epochs, adding more communication rounds, or using a server-side learning rate schedule to close this gap.`)
  }
  if (nodeCount === 1) {
    recs.push('Training used a single node. Recruiting additional institutions will improve model generalisation and increase statistical confidence in results.')
  }
  if (convergenceRound && convergenceRound < (job.num_rounds || job.total_rounds) * 0.6) {
    recs.push(`Model appears to have converged around round ${convergenceRound}. Future studies on this dataset may achieve similar performance with fewer communication rounds, reducing privacy exposure and cost.`)
  }
  if (worst && worst.acc < 60) {
    recs.push(`Class "${worst.name}" achieved only ${worst.acc}% accuracy. Review class balance in the training data; this class may be underrepresented across participating nodes.`)
  }
  if (recs.length === 0) {
    recs.push('Performance is within expected range for this dataset and architecture. Consider extending to additional institutions to further validate generalisation across populations.')
  }

  return { ds, dsKey, archKey, accuracy, baseline, vsBaseline, rating, ratingColor, rounds, classes, best, worst, highRiskUnderperforming, convergenceRound, nodeCount, earlyGain, recs }
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '18px 22px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StudyReport({ job }) {
  const r = useMemo(() => computeReport(job), [job])

  if (job.status !== 'completed') {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 32, textAlign: 'center', color: '#9ca3af' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Report available after training completes</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>Current status: <strong>{job.status}</strong></div>
      </div>
    )
  }

  const pct = (r.accuracy * 100).toFixed(1)
  const archLabel = ARCH_NAMES[r.archKey.toLowerCase()] || r.archKey
  const totalRounds = job.num_rounds || job.total_rounds || 0
  const duration = job.started_at && job.completed_at
    ? Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 60000)
    : null

  return (
    <div style={{ fontSize: 14 }}>

      {/* ── Print button ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14, gap: 8 }} className="no-print">
        <button
          onClick={() => window.print()}
          style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
        >
          Export / Print
        </button>
      </div>

      {/* ── Executive summary ── */}
      <Section title="Executive Summary">
        <p style={{ margin: '0 0 10px', lineHeight: 1.7, color: '#374151' }}>
          This{' '}<strong>{archLabel}</strong> model was trained using Federated Averaging (FedAvg) across{' '}
          <strong>{r.nodeCount} participating institution{r.nodeCount !== 1 ? 's' : ''}</strong> over{' '}
          <strong>{totalRounds} communication round{totalRounds !== 1 ? 's' : ''}</strong>
          {duration ? ` (${duration} minutes total wall-clock time)` : ''}.
          {r.ds ? ` The task was ${r.ds.task} in the domain of ${r.ds.domain}.` : ''}
        </p>
        <p style={{ margin: '0 0 10px', lineHeight: 1.7, color: '#374151' }}>
          The global federated model achieved a final classification accuracy of{' '}
          <strong style={{ color: '#059669' }}>{pct}%</strong> on the{' '}
          {r.ds ? <em>{r.ds.full}</em> : <strong>{job.dataset}</strong>} test set.{' '}
          {r.baseline != null
            ? r.vsBaseline >= 0
              ? `This ${r.vsBaseline >= 0.02 ? 'exceeds' : 'matches'} the published centralised benchmark of ${(r.baseline * 100).toFixed(1)}% for ${archLabel} on this dataset, demonstrating that federated training preserved model quality without centralising patient data.`
              : `This is ${Math.abs(r.vsBaseline * 100).toFixed(1)}% below the published centralised benchmark of ${(r.baseline * 100).toFixed(1)}% for ${archLabel}, which is typical for federated settings due to data heterogeneity across sites.`
            : ''}
        </p>
        {r.convergenceRound && (
          <p style={{ margin: '0 0 10px', lineHeight: 1.7, color: '#374151' }}>
            Training dynamics indicate the model converged at approximately{' '}
            <strong>round {r.convergenceRound}</strong>, with a mean accuracy gain of{' '}
            <strong>{r.earlyGain.toFixed(2)}% per round</strong> during the active learning phase.
          </p>
        )}
        {r.best && r.worst && r.classes.length > 1 && (
          <p style={{ margin: 0, lineHeight: 1.7, color: '#374151' }}>
            The model demonstrated strongest discrimination for{' '}
            <strong>{r.best.name}</strong> ({r.best.acc}%){r.best.risk !== 'low' ? ` — a ${r.best.risk}-risk class` : ''}.{' '}
            Sensitivity was lowest for <strong>{r.worst.name}</strong> ({r.worst.acc}%)
            {r.ds?.classes?.[r.worst.key]?.note ? ` (${r.ds.classes[r.worst.key].note.split(';')[0]})` : ''}.
            {r.highRiskUnderperforming.length > 0
              ? ` This is clinically significant: ${r.highRiskUnderperforming.map(c => c.name).join(' and ')} ${r.highRiskUnderperforming.length > 1 ? 'are' : 'is'} high-risk ${r.highRiskUnderperforming.length > 1 ? 'classes' : 'class'} performing below the 80% clinical acceptability threshold.`
              : ' All high-risk classes performed above the 80% clinical acceptability threshold.'}
          </p>
        )}
      </Section>

      {/* ── Performance benchmark ── */}
      <Section title="Performance Benchmark">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Federated accuracy</div>
            <div style={{ fontSize: 42, fontWeight: 800, color: '#059669', lineHeight: 1 }}>{pct}%</div>
            <div style={{ marginTop: 8, display: 'inline-block', background: RISK_BG[r.ratingColor === '#059669' ? 'low' : r.ratingColor === '#d97706' ? 'moderate' : r.ratingColor === '#dc2626' ? 'critical' : 'low'], color: r.ratingColor, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
              {r.rating}
            </div>
          </div>
          {r.baseline != null && (
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Published centralised baseline ({archLabel})</div>
              <div style={{ fontSize: 42, fontWeight: 800, color: '#6b7280', lineHeight: 1 }}>{(r.baseline * 100).toFixed(1)}%</div>
              <div style={{ marginTop: 8, fontSize: 12, color: r.vsBaseline >= 0 ? '#059669' : '#d97706', fontWeight: 600 }}>
                {r.vsBaseline >= 0 ? '▲' : '▼'} {Math.abs(r.vsBaseline * 100).toFixed(1)}% vs centralised
              </div>
            </div>
          )}
          {r.ds && (
            <div style={{ flex: 2, minWidth: 200, background: '#f9fafb', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{r.ds.full}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Domain: {r.ds.domain}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Task: {r.ds.task}</div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Training dynamics ── */}
      {r.rounds.length > 0 && (
        <Section title="Training Dynamics">
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            Global accuracy and loss across {r.rounds.length} federated round{r.rounds.length !== 1 ? 's' : ''}.
            {r.convergenceRound ? ` Convergence detected at round ${r.convergenceRound}.` : ''}
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={r.rounds} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="round" tick={{ fontSize: 11, fill: '#9ca3af' }} label={{ value: 'Round', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#9ca3af' }} />
              <YAxis yAxisId="a" domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" width={40} />
              <YAxis yAxisId="l" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} width={44} />
              <Tooltip formatter={(v, n) => n === 'Accuracy' ? `${v}%` : v} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {r.convergenceRound && (
                <ReferenceLine yAxisId="a" x={r.convergenceRound} stroke="#f59e0b" strokeDasharray="4 2"
                  label={{ value: 'Converged', position: 'top', fontSize: 10, fill: '#f59e0b' }} />
              )}
              <Line yAxisId="a" type="monotone" dataKey="acc" name="Accuracy" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line yAxisId="l" type="monotone" dataKey="loss" name="Loss" stroke="#dc2626" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* ── Clinical class analysis ── */}
      {r.classes.length > 0 && (
        <Section title="Clinical Class Analysis">
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            Per-class accuracy with clinical risk classification. Classes below 80% in high/critical risk categories require attention.
          </div>

          {/* Bar chart */}
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={r.classes} margin={{ top: 4, right: 16, left: 0, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="key" tick={{ fontSize: 10, fill: '#6b7280' }} angle={-30} textAnchor="end" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" width={38} />
              <Tooltip formatter={(v, n, p) => [`${v}%`, p.payload.name]} />
              <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '80% threshold', position: 'right', fontSize: 10, fill: '#d97706' }} />
              <Bar dataKey="acc" name="Accuracy" radius={[4, 4, 0, 0]}>
                {r.classes.map((c, i) => (
                  <Cell key={i} fill={
                    c.acc >= 90 ? '#059669' :
                    c.acc >= 80 ? '#1d4ed8' :
                    c.acc >= 65 ? '#d97706' : '#dc2626'
                  } />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Clinical table */}
          <div style={{ overflowX: 'auto', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Class', 'Clinical Name', 'Accuracy', 'Risk Level', 'Clinical Note'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.classes.map((c, i) => (
                  <tr key={i} style={{ background: (c.risk === 'critical' || c.risk === 'high') && c.acc < 80 ? '#fff7f7' : '#fff' }}>
                    <td style={{ padding: '9px 12px', fontWeight: 700, borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace' }}>{c.key}</td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #f3f4f6' }}>{c.name}</td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 700, color: c.acc >= 80 ? '#059669' : '#dc2626' }}>
                      {c.acc}%
                    </td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ background: RISK_BG[c.risk], color: RISK_COLOR[c.risk], padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
                        {c.risk}
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #f3f4f6', color: '#6b7280', maxWidth: 300 }}>{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── Federation summary ── */}
      <Section title="Federation Summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          {[
            { label: 'Institutions', value: r.nodeCount },
            { label: 'Rounds completed', value: `${job.current_round || totalRounds} / ${totalRounds}` },
            { label: 'FL algorithm', value: 'FedAvg' },
            { label: 'Architecture', value: archLabel },
            { label: 'Dataset', value: job.dataset },
            duration && { label: 'Training time', value: `${duration} min` },
          ].filter(Boolean).map(({ label, value }) => (
            <div key={label} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>{label}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{value}</div>
            </div>
          ))}
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
          All model weights were aggregated server-side using FedAvg. No raw patient data or imaging data
          left participating institutions at any point during training. Each node contributed only locally
          computed gradient updates.
        </p>
      </Section>

      {/* ── Recommendations ── */}
      <Section title="Recommendations">
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          {r.recs.map((rec, i) => (
            <li key={i} style={{ marginBottom: 8, fontSize: 13, color: '#374151' }}>{rec}</li>
          ))}
        </ol>
      </Section>

      {/* ── Methodology ── */}
      <Section title="Methodology">
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
          <strong>Model:</strong> {archLabel} trained via Federated Averaging (McMahan et al., 2017).{' '}
          <strong>Dataset:</strong> {r.ds?.full || job.dataset}.{' '}
          <strong>Rounds:</strong> {totalRounds} global communication rounds
          {job.local_epochs ? ` × ${job.local_epochs} local epoch${job.local_epochs !== 1 ? 's' : ''}` : ''}.{' '}
          {job.dp_enabled
            ? <><strong>Privacy:</strong> Differential privacy enabled (ε = {job.dp_epsilon}, δ = {job.dp_delta}, noise σ = {job.dp_noise_multiplier}).</>
            : <><strong>Privacy:</strong> Data remained on-premise at each institution; no differential privacy applied in this study.</>
          }{' '}
          <strong>Aggregation:</strong> Server-side FedAvg with equal weight per participating node.
        </div>
        <p style={{ marginTop: 10, fontSize: 12, color: '#9ca3af' }}>
          Study ID: {job.study_id || job.id} · Completed: {job.completed_at ? new Date(job.completed_at).toLocaleString() : '—'}
        </p>
      </Section>

    </div>
  )
}
