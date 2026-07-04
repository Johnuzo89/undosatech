// portal/src/components/StudyReport.jsx
import { useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend,
} from 'recharts'

// ── MedMNIST clinical registry ────────────────────────────────────────────────
const MEDMNIST = {
  octmnist: {
    full: 'OCT-MNIST (Optical Coherence Tomography)', domain: 'Ophthalmology',
    task: 'Retinal OCT scan classification',
    baseline: { resnet18: 0.761, resnet50: 0.772, efficientnet_b0: 0.789, densenet121: 0.782, convnext_tiny: 0.795, swin_t: 0.791 },
    classes: {
      CNV:    { name: 'Choroidal Neovascularisation', risk: 'critical',
                note: 'Wet AMD — requires urgent anti-VEGF treatment; missed detection risks permanent vision loss' },
      DME:    { name: 'Diabetic Macular Oedema',      risk: 'critical',
                note: 'Vision-threatening diabetic complication; delayed treatment worsens prognosis significantly' },
      DRUSEN: { name: 'Drusen / Early Dry AMD',        risk: 'moderate',
                note: 'Precursor to advanced AMD; monitor every 6–12 months for conversion to wet form' },
      NORMAL: { name: 'Normal Retina',                 risk: 'low',
                note: 'No detectable retinal pathology; routine annual screening recommended' },
    },
  },
  pathmnist: {
    full: 'Path-MNIST (Colorectal Histopathology)', domain: 'Histopathology / Oncology',
    task: 'Colorectal tissue patch classification (9-class)',
    baseline: { resnet18: 0.954, resnet50: 0.961, densenet121: 0.947, convnext_tiny: 0.968, swin_t: 0.965, efficientnet_v2_s: 0.963 },
    classes: {
      TUM:  { name: 'Colorectal Adenocarcinoma', risk: 'critical',
              note: 'Malignant epithelium — primary diagnostic target; false negatives directly delay cancer treatment' },
      STR:  { name: 'Cancer-Associated Stroma',  risk: 'high',
              note: 'Desmoplastic stromal changes are a marker of tumour invasion and prognostic staging' },
      LYM:  { name: 'Lymphocytic Infiltrate',    risk: 'moderate',
              note: 'Immune response indicator; density affects TNM staging and immunotherapy eligibility' },
      MUS:  { name: 'Smooth Muscle (Muscularis)', risk: 'low',
              note: 'Structural layer; depth of invasion through muscularis is critical for staging' },
      NORM: { name: 'Normal Colon Mucosa',        risk: 'low',
              note: 'Healthy epithelium; high accuracy here prevents unnecessary biopsies' },
      ADI:  { name: 'Adipose Tissue',            risk: 'low',  note: 'Normal pericolic fat tissue' },
      MUC:  { name: 'Mucus',                     risk: 'low',  note: 'Mucosal secretion; non-diagnostic' },
      DEB:  { name: 'Debris',                    risk: 'low',  note: 'Non-cellular slide debris; should not be mistaken for tissue' },
      BACK: { name: 'Background',                risk: 'low',  note: 'Non-tissue slide area; should reach near 100%' },
    },
  },
  chestmnist: {
    full: 'Chest-MNIST (NIH Chest X-Ray 14)', domain: 'Radiology / Pulmonology',
    task: 'Multi-label chest pathology detection (14 findings)',
    baseline: { resnet18: 0.941, resnet50: 0.947, densenet121: 0.948, convnext_tiny: 0.952, swin_t: 0.950 },
    classes: {
      Pneumothorax:  { name: 'Pneumothorax',        risk: 'critical',
                       note: 'Collapsed lung — a false negative is immediately life-threatening; requires emergency decompression' },
      Mass:          { name: 'Pulmonary Mass',       risk: 'critical',
                       note: 'Possible lung malignancy; each week of delayed detection reduces 5-year survival' },
      Nodule:        { name: 'Pulmonary Nodule',     risk: 'high',
                       note: 'Potential early-stage lung cancer; missed detection at screening stage is the most preventable failure mode' },
      Cardiomegaly:  { name: 'Cardiomegaly',         risk: 'high',  note: 'Enlarged heart; indicator of cardiac disease requiring urgent work-up' },
      Effusion:      { name: 'Pleural Effusion',     risk: 'high',  note: 'Fluid accumulation; may indicate heart failure, malignancy or infection' },
      Edema:         { name: 'Pulmonary Oedema',     risk: 'high',  note: 'Fluid in lung parenchyma; major heart failure indicator' },
      Pneumonia:     { name: 'Pneumonia',            risk: 'high',  note: 'Lung infection; early detection and antibiotic treatment significantly reduce mortality' },
      Atelectasis:   { name: 'Atelectasis',          risk: 'moderate', note: 'Partial lung collapse; may indicate bronchial obstruction or post-op complication' },
      Infiltration:  { name: 'Infiltration',         risk: 'moderate', note: 'Airspace opacification; infection, inflammation or aspiration' },
      Consolidation: { name: 'Consolidation',        risk: 'moderate', note: 'Alveolar consolidation; typical of lobar pneumonia or organising pneumonia' },
      Emphysema:     { name: 'Emphysema',            risk: 'moderate', note: 'Irreversible alveolar destruction; COPD staging implications' },
      Fibrosis:      { name: 'Pulmonary Fibrosis',   risk: 'moderate', note: 'Progressive lung scarring; ILD monitoring and anti-fibrotic eligibility' },
      Pleural:       { name: 'Pleural Thickening',   risk: 'low',   note: 'Usually benign sequela; can indicate prior asbestos exposure' },
      Hernia:        { name: 'Diaphragmatic Hernia', risk: 'low',   note: 'Abdominal contents herniation; usually incidental finding' },
    },
  },
  dermamnist: {
    full: 'Derma-MNIST (HAM10000 Skin Lesion)', domain: 'Dermatology / Oncology',
    task: 'Dermoscopic skin lesion classification (7-class)',
    baseline: { resnet18: 0.731, resnet50: 0.745, densenet121: 0.748, convnext_tiny: 0.762, efficientnet_b4: 0.753, swin_t: 0.757 },
    classes: {
      MEL:  { name: 'Melanoma',              risk: 'critical',
              note: 'Deadliest skin cancer; 5-year survival drops from 99% to 25% once metastatic — earliest detection is critical' },
      BCC:  { name: 'Basal Cell Carcinoma',  risk: 'high',
              note: 'Most common skin cancer; locally destructive but rarely metastasises; missed lesions grow and require more invasive surgery' },
      AK:   { name: 'Actinic Keratosis',     risk: 'moderate',
              note: 'Pre-cancerous sun-damaged keratinocytes; ~10% progress to SCC without treatment' },
      NV:   { name: 'Melanocytic Naevus',    risk: 'low',
              note: 'Common benign mole; high recall here reduces unnecessary biopsies (most common class — class imbalance challenge)' },
      BKL:  { name: 'Benign Keratosis',      risk: 'low',  note: 'Seborrhoeic keratosis, solar lentigo; benign' },
      DF:   { name: 'Dermatofibroma',        risk: 'low',  note: 'Benign fibrous nodule; clinical diagnosis usually sufficient' },
      VASC: { name: 'Vascular Lesion',       risk: 'low',  note: 'Angioma, pyogenic granuloma; benign vascular tumour' },
    },
  },
  breastmnist: {
    full: 'Breast-MNIST (Breast Ultrasound)', domain: 'Oncology / Radiology',
    task: 'Breast ultrasound lesion binary classification',
    baseline: { resnet18: 0.883, resnet50: 0.891, densenet121: 0.899, convnext_tiny: 0.907, efficientnet_b4: 0.895 },
    classes: {
      Malignant: { name: 'Malignant Mass', risk: 'critical',
                   note: 'Breast cancer — a false negative on a screening scan has catastrophic, irreversible consequences; sensitivity must be maximised even at cost of specificity' },
      Benign:    { name: 'Benign Mass',    risk: 'low',
                   note: 'Non-cancerous cyst or fibroadenoma; unnecessary biopsy is morbid but not life-threatening — favour high sensitivity for Malignant class' },
    },
  },
  bloodmnist: {
    full: 'Blood-MNIST (Peripheral Blood Smear)', domain: 'Haematology / Pathology',
    task: 'Microscopic peripheral blood cell classification (8-class)',
    baseline: { resnet18: 0.962, resnet50: 0.971, densenet121: 0.977, convnext_tiny: 0.983, efficientnet_v2_s: 0.979 },
    classes: {
      Ig:           { name: 'Immature Granulocyte', risk: 'high',
                      note: 'Left shift — indicates infection, leukaemia, or bone marrow stress; missed detection delays diagnosis' },
      Erythroblast: { name: 'Erythroblast',         risk: 'moderate',
                      note: 'Immature nucleated RBC; presence in circulation indicates haemolytic anaemia or severe blood loss' },
      Basophil:     { name: 'Basophil',             risk: 'moderate',
                      note: 'Elevated in allergic reactions and CML (chronic myeloid leukaemia); rare cell — class imbalance challenge' },
      Eosinophil:   { name: 'Eosinophil',           risk: 'moderate',
                      note: 'Parasitic infection or allergic disease marker; eosinophilia also seen in hypereosinophilic syndrome' },
      Monocyte:     { name: 'Monocyte',             risk: 'low',  note: 'Innate immune phagocyte; monocytosis may indicate chronic infection' },
      Neutrophil:   { name: 'Neutrophil',           risk: 'low',  note: 'Primary bacterial infection fighter; most abundant WBC — high sample count aids accuracy' },
      Lymphocyte:   { name: 'Lymphocyte',           risk: 'low',  note: 'Adaptive immune cell; lymphocytosis in viral infection and CLL' },
      Platelet:     { name: 'Platelet (Thrombocyte)',risk: 'low',  note: 'Clotting function; thrombocytopenia risk if counted poorly on CBC automation' },
    },
  },
  tissuemnist: {
    full: 'Tissue-MNIST (Kidney Cortex Microscopy)', domain: 'Renal Pathology',
    task: 'Kidney cortex histological tissue patch classification (8-class)',
    baseline: { resnet18: 0.679, resnet50: 0.694 },
    classes: {
      'Colorectal adenocarcinoma epithelium': { name: 'Adenocarcinoma Epithelium', risk: 'critical',
        note: 'Malignant epithelium — primary diagnostic target; note this dataset uses kidney cortex tiles labelled with colorectal tissue types' },
      'Cancer-associated stroma':             { name: 'Tumour-Associated Stroma',  risk: 'high',
        note: 'Desmoplastic stromal changes; strong prognostic marker for invasion' },
      Lymphocytes: { name: 'Lymphocytic Infiltrate', risk: 'moderate',
                    note: 'Tumour-infiltrating lymphocytes (TILs); high TIL density is associated with better immunotherapy response' },
      'Smooth muscle':       { name: 'Smooth Muscle',        risk: 'low', note: 'Vascular smooth muscle; normal renal cortex structure' },
      'Normal colon mucosa': { name: 'Normal Cortical Tissue',risk: 'low', note: 'Healthy kidney cortex epithelium; high accuracy expected' },
      Mucus:      { name: 'Mucus',       risk: 'low', note: 'Mucosal secretion artefact' },
      Adipose:    { name: 'Adipose Tissue', risk: 'low', note: 'Perirenal fat; easy to classify' },
      Background: { name: 'Background',    risk: 'low', note: 'Non-tissue area; should reach near 100%' },
      Debris:     { name: 'Debris',        risk: 'low', note: 'Cellular debris or preparation artefact' },
    },
  },
  retinamnist: {
    full: 'Retina-MNIST (Diabetic Retinopathy Grading)', domain: 'Ophthalmology / Diabetology',
    task: 'Fundus photograph DR severity grading (5 ordinal grades)',
    baseline: { resnet18: 0.528, resnet50: 0.535 },
    classes: {
      'Grade 4': { name: 'Proliferative DR (PDR)',     risk: 'critical',
                   note: 'Advanced neovascularisation with vitreous haemorrhage risk; immediate panretinal laser or anti-VEGF required to prevent blindness' },
      'Grade 3': { name: 'Severe Non-Proliferative DR', risk: 'high',
                   note: '50% risk of PDR within 1 year; requires urgent ophthalmology referral and early treatment' },
      'Grade 2': { name: 'Moderate Non-Proliferative DR', risk: 'moderate',
                   note: 'Microaneurysms and haemorrhages beyond mild; 6-month review; optimise glycaemic and BP control' },
      'Grade 1': { name: 'Mild Non-Proliferative DR',  risk: 'low',
                   note: 'Microaneurysms only; annual review; lifestyle and metabolic optimisation' },
      'Grade 0': { name: 'No Diabetic Retinopathy',    risk: 'low',
                   note: 'No DR detected; routine annual diabetic eye screening; reassure patient' },
    },
  },
  pneumoniamnist: {
    full: 'Pneumonia-MNIST (Paediatric Chest X-Ray)', domain: 'Radiology / Paediatrics',
    task: 'Pneumonia detection from paediatric chest radiograph (binary)',
    baseline: { resnet18: 0.845, resnet50: 0.862, densenet121: 0.876, convnext_tiny: 0.881, efficientnet_b4: 0.871 },
    classes: {
      Pneumonia: { name: 'Pneumonia (Bacterial/Viral)', risk: 'high',
                   note: 'Leading cause of child mortality globally; early detection and antibiotic treatment significantly reduce mortality — maximise sensitivity over specificity' },
      Normal:    { name: 'Normal Chest',                risk: 'low',
                   note: 'No pneumonia; high specificity here prevents unnecessary antibiotic prescribing and admission' },
    },
  },
  organamnist: {
    full: 'OrganA-MNIST (Abdominal CT)', domain: 'Radiology / Anatomy',
    task: 'Abdominal organ localisation from axial CT slices (11-class)',
    baseline: { resnet18: 0.954, resnet50: 0.963, densenet121: 0.971, convnext_tiny: 0.978, swin_t: 0.975, efficientnet_v2_s: 0.974 },
    classes: {
      Liver:      { name: 'Liver',       risk: 'low', note: 'Largest abdominal organ; highly distinctive shape — easy to classify' },
      'Kidney-L': { name: 'Left Kidney', risk: 'low', note: 'Retroperitoneal; bilateral symmetry can cause confusion with right kidney' },
      'Kidney-R': { name: 'Right Kidney',risk: 'low', note: 'Retroperitoneal; slightly lower than left; bilateral confusion is common failure mode' },
      Spleen:     { name: 'Spleen',      risk: 'low', note: 'Left upper quadrant; confusion with left kidney possible on single axial slice' },
      Pancreas:   { name: 'Pancreas',    risk: 'low', note: 'Smallest organ in the set; irregular shape and variable position make this the hardest class' },
      Heart:      { name: 'Heart',       risk: 'low', note: 'Mediastinal structure; visible on abdominal CT' },
      'Lung-L':   { name: 'Left Lung',   risk: 'low', note: 'Left pulmonary base; high contrast from air content aids classification' },
      'Lung-R':   { name: 'Right Lung',  risk: 'low', note: 'Right pulmonary base; similar to left lung — confusion between the two is the primary failure mode' },
      Bladder:    { name: 'Urinary Bladder', risk: 'low', note: 'Pelvic structure; visible on lower abdominal slices only' },
      'Femur-L':  { name: 'Left Femoral Head', risk: 'low', note: 'Bony structure; very distinctive radiodensity — should achieve high accuracy' },
      'Femur-R':  { name: 'Right Femoral Head',risk: 'low', note: 'Mirror of left femoral head; bilateral confusion is the primary failure mode' },
    },
  },
}

const ARCH_LABELS = {
  resnet18: 'ResNet-18', resnet50: 'ResNet-50', resnet101: 'ResNet-101',
  densenet121: 'DenseNet-121',
  efficientnet_b0: 'EfficientNet-B0', efficientnet_b4: 'EfficientNet-B4',
  efficientnet_v2_s: 'EfficientNet-V2-S',
  mobilenet_v3: 'MobileNetV3-Large',
  convnext_tiny: 'ConvNeXt-Tiny',
  swin_t: 'Swin-T',
  vit_b16: 'ViT-B/16', vit_b_16: 'ViT-B/16',
  cnn: 'Lightweight CNN', lightweight_cnn: 'Lightweight CNN',
}

const RISK_COLOR = { critical: '#dc2626', high: '#d97706', moderate: '#ca8a04', low: '#16a34a' }
const RISK_BG    = { critical: '#fef2f2', high: '#fffbeb', moderate: '#fefce8', low: '#f0fdf4' }

// Statistical performance tier — NOT a clinical certification
function perfTier(f1) {
  if (f1 == null) return null
  if (f1 >= 0.90) return { label: 'Strong (F1 ≥ 0.90)',    color: '#059669', bg: '#f0fdf4' }
  if (f1 >= 0.75) return { label: 'Moderate (F1 ≥ 0.75)',  color: '#1d4ed8', bg: '#eff6ff' }
  if (f1 >= 0.60) return { label: 'Weak (F1 ≥ 0.60)',      color: '#d97706', bg: '#fffbeb' }
  return          { label: 'Poor (F1 < 0.60)',              color: '#dc2626', bg: '#fef2f2' }
}

// ── Dataset key resolution ────────────────────────────────────────────────────
function resolveDsKey(datasetName) {
  if (!datasetName) return null
  const norm = datasetName.toLowerCase().replace(/[-_ ]/g, '')
  if (MEDMNIST[norm]) return norm
  // Try strip "mnist" suffix patterns like "organamnist" vs "organaMNIST"
  for (const k of Object.keys(MEDMNIST)) {
    if (norm.includes(k) || k.includes(norm)) return k
  }
  return null
}

// ── Normalise per_class_accuracy to named entries ────────────────────────────
// Handles: dict with string keys, dict with numeric string keys "0"/"1"/...,
// plain array, and maps to clinical info when available
function buildClassEntries(job, ds) {
  const raw = job.per_class_accuracy
  if (!raw) return []

  const nameList = (
    job.class_names ||
    job.interpretability?.class_labels ||
    (ds ? Object.keys(ds.classes) : null) ||
    []
  )

  // per_class_metrics: {"ClassName": {recall, precision, f1, support}}
  const prf = (() => {
    const m = job.per_class_metrics
    if (!m) return {}
    if (typeof m === 'string') { try { return JSON.parse(m) } catch { return {} } }
    return m
  })()

  let pairs = []
  if (Array.isArray(raw)) {
    pairs = raw.map((v, i) => [nameList[i] || `Class ${i}`, v])
  } else if (typeof raw === 'object') {
    pairs = Object.entries(raw).map(([k, v]) => {
      const idx = !isNaN(k) ? +k : -1
      const name = idx >= 0 && nameList[idx] ? nameList[idx] : k
      return [name, v]
    })
  }

  // Researcher-written descriptions for custom datasets
  const customDescs = (() => {
    const d = job.class_descriptions
    if (!d) return {}
    if (typeof d === 'string') { try { return JSON.parse(d) } catch { return {} } }
    return d
  })()

  return pairs
    .map(([key, acc]) => {
      const accPct  = +(Number(acc) * 100).toFixed(1)
      const metrics = prf[key] || null
      const info = ds?.classes?.[key] || { name: key, risk: 'low', note: customDescs[key] || '—' }
      if (info.note === '—' && customDescs[key]) info.note = customDescs[key]
      return {
        key, accPct, ...info,
        recall:           metrics ? +(metrics.recall            * 100).toFixed(1) : null,
        precision:        metrics ? +(metrics.precision         * 100).toFixed(1) : null,
        f1:               metrics ? +metrics.f1.toFixed(3)                        : null,
        specificity:      metrics?.specificity      != null ? +(metrics.specificity      * 100).toFixed(1) : null,
        balanced_acc:     metrics?.balanced_accuracy != null ? +(metrics.balanced_accuracy * 100).toFixed(1) : null,
        support:          metrics?.support ?? null,
      }
    })
    .sort((a, b) => b.accPct - a.accPct)
}

// ── Per-class trend from round history ───────────────────────────────────────
function buildClassTrends(job, classEntries) {
  const roundResults = job.round_results || []
  if (roundResults.length < 2 || classEntries.length === 0) return {}
  const nameList = job.class_names || job.interpretability?.class_labels || []
  const trends = {}
  for (const ce of classEntries) {
    const series = []
    for (const r of roundResults) {
      const rawPc = r.per_class_accuracy
      if (!rawPc) continue
      let val = null
      if (Array.isArray(rawPc)) {
        const idx = nameList.indexOf(ce.key)
        val = idx >= 0 ? rawPc[idx] : rawPc[classEntries.findIndex(c => c.key === ce.key)]
      } else if (typeof rawPc === 'object') {
        val = rawPc[ce.key] ?? rawPc[nameList.indexOf(ce.key)]
      }
      if (val != null) series.push(+(Number(val) * 100).toFixed(1))
    }
    if (series.length >= 2) {
      const delta = series[series.length - 1] - series[0]
      trends[ce.key] = { delta: +delta.toFixed(1), final: series[series.length - 1] }
    }
  }
  return trends
}

// ── Round chart data ──────────────────────────────────────────────────────────
function buildRoundChart(job) {
  const raw = (job.rounds?.length > 0 ? job.rounds : job.round_results) || []
  return raw.map(r => ({
    round: r.round_number ?? r.round ?? 0,
    acc:   +((r.accuracy ?? r.global_accuracy ?? 0) * 100).toFixed(2),
    loss:  +(r.loss ?? r.global_loss ?? 0).toFixed(4),
  }))
}

function findConvergence(rounds) {
  for (let i = 2; i < rounds.length; i++) {
    if (Math.abs(rounds[i].acc - rounds[i - 1].acc) < 0.3) return rounds[i].round
  }
  return null
}

function getBaseline(dsKey, archKey) {
  const ds = MEDMNIST[dsKey]
  if (!ds) return null
  const a = archKey.toLowerCase()
  if (a === 'resnet18'  || a.includes('resnet-18'))   return ds.baseline?.resnet18
  if (a === 'resnet50'  || a.includes('resnet-50'))   return ds.baseline?.resnet50
  if (a === 'resnet101' || a.includes('resnet-101'))  return ds.baseline?.resnet101
  if (a === 'densenet121' || a.includes('densenet'))  return ds.baseline?.densenet121
  if (a === 'efficientnet_b0')                        return ds.baseline?.efficientnet_b0
  if (a === 'efficientnet_b4')                        return ds.baseline?.efficientnet_b4
  if (a === 'efficientnet_v2_s')                      return ds.baseline?.efficientnet_v2_s
  if (a === 'mobilenet_v3' || a.includes('mobilenet'))return ds.baseline?.mobilenet_v3
  if (a === 'convnext_tiny' || a.includes('convnext'))return ds.baseline?.convnext_tiny
  if (a === 'swin_t' || a.includes('swin'))           return ds.baseline?.swin_t
  return Object.values(ds.baseline || {})[0] ?? null
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Sec({ title, sub, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: '20px 24px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</span>
        {sub && <span style={{ fontSize: 11, color: '#AEAEB2', marginLeft: 8 }}>{sub}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function StudyReport({ job }) {
  const computed = useMemo(() => {
    const dsKey   = resolveDsKey(job.dataset)
    const ds      = dsKey ? MEDMNIST[dsKey] : null
    const archKey = (job.architecture || job.model || '').toLowerCase()
    const archLabel = ARCH_LABELS[archKey] || job.architecture || job.model || 'Unknown'
    const accuracy  = job.final_accuracy ?? 0
    const baseline  = getBaseline(dsKey, archKey)
    const vsBaseline = baseline != null ? accuracy - baseline : null
    const rounds   = buildRoundChart(job)
    const convergeRound = findConvergence(rounds)
    const classes  = buildClassEntries(job, ds)
    const trends   = buildClassTrends(job, classes)
    const nodeCount = job.nodes?.length || 1
    const totalRounds = job.num_rounds || job.total_rounds || 0
    const duration = job.started_at && job.completed_at
      ? Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 60000) : null

    // Macro accuracy (unweighted mean of per-class accuracies)
    const macroAcc = classes.length > 0
      ? +(classes.reduce((s, c) => s + c.accPct, 0) / classes.length).toFixed(1) : null

    // High-risk underperformers
    const highRiskUnder = classes.filter(c => (c.risk === 'critical' || c.risk === 'high') && c.accPct < 80)

    // Recommendations
    const recs = []
    if (highRiskUnder.length > 0)
      recs.push(`Prioritise additional training data for ${highRiskUnder.map(c => c.name).join(', ')} — high-risk classes performing below 80% carry the greatest patient safety impact.`)
    if (vsBaseline != null && vsBaseline < -0.05)
      recs.push(`Federated accuracy is ${Math.abs(vsBaseline * 100).toFixed(1)}% below the centralised benchmark. Consider increasing local epochs, adding more rounds, or applying a server-side learning rate schedule.`)
    if (nodeCount === 1)
      recs.push('Only one institution contributed to this study. Recruiting additional nodes will improve generalisation across demographics and imaging equipment types.')
    if (convergeRound && convergeRound < totalRounds * 0.6)
      recs.push(`Convergence detected at round ${convergeRound} (${Math.round(convergeRound / totalRounds * 100)}% of budget). Future studies may match this performance with fewer rounds, reducing cost and privacy exposure.`)
    const worst = classes[classes.length - 1]
    if (worst && worst.accPct < 60)
      recs.push(`"${worst.name}" achieved only ${worst.accPct}% accuracy. Check class balance in training data — this class may be severely underrepresented or structurally difficult across sites.`)
    if (recs.length === 0)
      recs.push('Performance is within acceptable range. Extend to additional institutions to validate generalisation across populations and imaging equipment.')
    if (!ds)
      recs.push('This study used a custom dataset. Add clinical metadata (class descriptions, risk levels) via the study configuration to unlock full clinical interpretation in future reports.')

    // Performance rating
    let rating, ratingColor
    if (vsBaseline != null) {
      if (vsBaseline >= 0.02)      { rating = 'Exceeds centralised baseline';    ratingColor = '#059669' }
      else if (vsBaseline >= -0.02){ rating = 'Matches centralised baseline';    ratingColor = '#1d4ed8' }
      else if (vsBaseline >= -0.08){ rating = 'Below centralised baseline';      ratingColor = '#d97706' }
      else                          { rating = 'Significantly below baseline';   ratingColor = '#dc2626' }
    } else {
      rating = accuracy >= 0.90 ? 'Strong performance' : accuracy >= 0.75 ? 'Moderate performance' : 'Developing'
      ratingColor = accuracy >= 0.90 ? '#059669' : accuracy >= 0.75 ? '#d97706' : '#dc2626'
    }

    // Study-level aggregate metrics from backend
    const macro_f1      = job.macro_f1      ?? (job.round_results?.length ? job.round_results[job.round_results.length-1]?.macro_f1      : null)
    const weighted_f1   = job.weighted_f1   ?? (job.round_results?.length ? job.round_results[job.round_results.length-1]?.weighted_f1   : null)
    const cohen_kappa   = job.cohen_kappa   ?? (job.round_results?.length ? job.round_results[job.round_results.length-1]?.cohen_kappa   : null)

    return { dsKey, ds, archKey, archLabel, accuracy, baseline, vsBaseline, rounds, convergeRound,
             classes, trends, nodeCount, totalRounds, duration, macroAcc, highRiskUnder, recs, rating, ratingColor,
             macro_f1, weighted_f1, cohen_kappa }
  }, [job])

  const { ds, archLabel, accuracy, baseline, vsBaseline, rounds, convergeRound,
          classes, trends, nodeCount, totalRounds, duration, macroAcc,
          highRiskUnder, recs, rating, ratingColor,
          macro_f1, weighted_f1, cohen_kappa } = computed

  if (job.status !== 'completed') {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 40, textAlign: 'center', color: '#9ca3af' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Report available after training completes</div>
        <div style={{ fontSize: 13 }}>Current status: <strong>{job.status}</strong></div>
      </div>
    )
  }

  const pct = (accuracy * 100).toFixed(1)
  const best  = classes[0]
  const worst = classes[classes.length - 1]

  return (
    <div style={{ fontSize: 14 }}>

      {/* Print button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={() => window.print()}
          style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
          Export / Print PDF
        </button>
      </div>

      {/* ── Executive Summary ── */}
      <Sec title="Executive Summary">
        <p style={{ margin: '0 0 10px', lineHeight: 1.75, color: '#374151' }}>
          <strong>{archLabel}</strong> trained via Federated Averaging across{' '}
          <strong>{nodeCount} institution{nodeCount !== 1 ? 's' : ''}</strong> over{' '}
          <strong>{totalRounds} communication round{totalRounds !== 1 ? 's' : ''}</strong>
          {duration ? ` (${duration} min total)` : ''}.
          {ds ? ` Task: ${ds.task} — ${ds.domain}.` : job.dataset ? ` Dataset: ${job.dataset}.` : ''}
        </p>
        <p style={{ margin: '0 0 10px', lineHeight: 1.75, color: '#374151' }}>
          Global federated accuracy: <strong style={{ color: '#059669' }}>{pct}%</strong>
          {macroAcc && macroAcc !== +pct
            ? <> (micro); <strong style={{ color: '#1d4ed8' }}>{macroAcc}%</strong> macro (unweighted class mean).</>
            : '.'}
          {baseline != null
            ? vsBaseline >= 0
              ? ` This ${vsBaseline >= 0.02 ? 'exceeds' : 'matches'} the published centralised benchmark of ${(baseline * 100).toFixed(1)}%, demonstrating that federated learning preserved model quality without centralising patient data.`
              : ` This is ${Math.abs(vsBaseline * 100).toFixed(1)}% below the centralised benchmark of ${(baseline * 100).toFixed(1)}%, consistent with typical federated performance degradation from data heterogeneity across sites.`
            : ''}
        </p>
        {convergeRound && (
          <p style={{ margin: '0 0 10px', lineHeight: 1.75, color: '#374151' }}>
            Training converged at approximately round <strong>{convergeRound}</strong> ({Math.round(convergeRound / totalRounds * 100)}% of the communication budget).
          </p>
        )}
        {best && worst && classes.length > 1 && (
          <p style={{ margin: 0, lineHeight: 1.75, color: '#374151' }}>
            Strongest: <strong>{best.name}</strong> ({best.accPct}%
            {best.risk !== 'low' ? `, ${best.risk} risk` : ''}).{' '}
            Weakest: <strong>{worst.name}</strong> ({worst.accPct}%
            {worst.risk !== 'low' ? `, ${worst.risk} risk` : ''}).{' '}
            {highRiskUnder.length > 0
              ? <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠ {highRiskUnder.length} high/critical-risk class{highRiskUnder.length > 1 ? 'es are' : ' is'} below the 80% clinical acceptability threshold.</span>
              : <span style={{ color: '#059669' }}>All high/critical-risk classes exceed the 80% threshold.</span>}
          </p>
        )}
      </Sec>

      {/* ── Performance Benchmark ── */}
      <Sec title="Performance Benchmark">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Federated (micro)</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: '#059669', lineHeight: 1 }}>{pct}%</div>
            {job.confidence_intervals?.accuracy && (
              <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 3 }}>
                95% CI: [{(job.confidence_intervals.accuracy.ci_lower * 100).toFixed(1)}% – {(job.confidence_intervals.accuracy.ci_upper * 100).toFixed(1)}%]
              </div>
            )}
            {macroAcc && (
              <div style={{ fontSize: 13, color: '#1d4ed8', marginTop: 4 }}>Macro avg: <strong>{macroAcc}%</strong></div>
            )}
            {macro_f1 != null && <div style={{ fontSize: 12, color: '#374151', marginTop: 3 }}>Macro F1: <strong>{macro_f1.toFixed(3)}</strong></div>}
            {weighted_f1 != null && <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>Weighted F1: <strong>{weighted_f1.toFixed(3)}</strong></div>}
            {cohen_kappa != null && (
              <div style={{ fontSize: 12, padding: '4px 10px', background: cohen_kappa >= 0.8 ? '#f0fdf4' : cohen_kappa >= 0.6 ? '#eff6ff' : '#fffbeb',
                border: `1px solid ${cohen_kappa >= 0.8 ? '#bbf7d0' : cohen_kappa >= 0.6 ? '#bfdbfe' : '#fde68a'}`,
                borderRadius: 6, display: 'inline-block', marginTop: 8 }}>
                Cohen's κ = <strong>{cohen_kappa.toFixed(3)}</strong>
                <span style={{ color: '#9ca3af', marginLeft: 6 }}>
                  {cohen_kappa >= 0.8 ? '(Almost perfect agreement)' : cohen_kappa >= 0.6 ? '(Substantial agreement)' : cohen_kappa >= 0.4 ? '(Moderate agreement)' : '(Fair agreement)'}
                </span>
              </div>
            )}
            <div style={{ marginTop: 8, display: 'inline-block', background: RISK_BG[ratingColor === '#059669' ? 'low' : ratingColor === '#dc2626' ? 'critical' : 'moderate'],
              color: ratingColor, padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{rating}</div>
          </div>
          {baseline != null && (
            <div style={{ minWidth: 160 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Published centralised ({archLabel})</div>
              <div style={{ fontSize: 44, fontWeight: 800, color: '#6b7280', lineHeight: 1 }}>{(baseline * 100).toFixed(1)}%</div>
              <div style={{ fontSize: 13, marginTop: 4, fontWeight: 600, color: vsBaseline >= 0 ? '#059669' : '#d97706' }}>
                {vsBaseline >= 0 ? '▲' : '▼'} {Math.abs(vsBaseline * 100).toFixed(1)}% vs centralised
              </div>
            </div>
          )}
          {ds && (
            <div style={{ flex: 1, minWidth: 200, background: '#f9fafb', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{ds.full}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Domain: {ds.domain}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Task: {ds.task}</div>
            </div>
          )}
          {!ds && (
            <div style={{ flex: 1, minWidth: 200, background: '#f9fafb', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Custom Dataset: {job.dataset}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>No published centralised benchmark available for this dataset. Performance is evaluated relative to class-level thresholds only.</div>
            </div>
          )}
        </div>
      </Sec>

      {/* ── Training Dynamics ── */}
      {rounds.length > 0 && (
        <Sec title="Training Dynamics" sub={`${rounds.length} rounds · FedAvg`}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Global accuracy and loss per communication round.
            {convergeRound ? ` Convergence detected at round ${convergeRound} (yellow marker).` : ' No early convergence detected within the training budget.'}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rounds} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="round" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis yAxisId="a" domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" width={42} />
              <YAxis yAxisId="l" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} width={46} />
              <Tooltip formatter={(v, n) => n === 'Accuracy' ? `${v}%` : v} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {convergeRound && (
                <ReferenceLine yAxisId="a" x={convergeRound} stroke="#f59e0b" strokeDasharray="4 2"
                  label={{ value: `Converged R${convergeRound}`, position: 'insideTopRight', fontSize: 10, fill: '#d97706' }} />
              )}
              <Line yAxisId="a" type="monotone" dataKey="acc" name="Accuracy" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line yAxisId="l" type="monotone" dataKey="loss" name="Loss" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Sec>
      )}

      {/* ── Class Analysis ── */}
      {classes.length > 0 && (
        <Sec title="Class-Level Analysis"
          sub={`${classes.length} classes · precision / recall / F1`}>

          {/* Disclaimer */}
          <div style={{ background: 'rgba(255,159,10,0.08)', border: '1px solid rgba(255,159,10,0.2)', borderRadius: 12, color: '#FF9F0A', padding: '10px 14px', marginBottom: 16, fontSize: 12, lineHeight: 1.6 }}>
            <strong>Research use only.</strong> These metrics describe statistical model performance on a benchmark test set.
            They do not constitute a clinical validation, regulatory clearance, or deployment recommendation.
            Clinical deployment requires prospective validation on the target population, site-specific calibration,
            and regulatory approval (FDA 510(k), CE marking, or equivalent).
            {!ds && ' Risk levels below are unclassified — consult domain experts to assign appropriate clinical risk to each class.'}
          </div>

          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
            <strong>Sensitivity</strong> (recall) = TP / (TP + FN) — the probability of detecting a true case.
            <strong> Specificity</strong> = TN / (TN + FP) — the probability of correctly ruling out a non-case.
            <strong> Balanced accuracy</strong> = (sensitivity + specificity) / 2 — robust to class imbalance.
            <strong> F1</strong> = harmonic mean of precision and sensitivity.
            High-risk classes with sensitivity below 80% are flagged — low sensitivity means the model misses real cases of that class.
          </div>

          {/* Bar chart */}
          <ResponsiveContainer width="100%" height={Math.max(160, classes.length * 22)}>
            <BarChart data={classes.map(c => ({ name: c.key, acc: c.accPct, risk: c.risk }))}
              layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={70} />
              <Tooltip formatter={(v) => [`${v}%`, 'Accuracy']} />
              <ReferenceLine x={80} stroke="#f59e0b" strokeDasharray="3 3" />
              <ReferenceLine x={92} stroke="#059669" strokeDasharray="3 3" />
              <Bar dataKey="acc" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#374151', formatter: v => `${v}%` }}>
                {classes.map((c, i) => (
                  <Cell key={i} fill={
                    c.accPct >= 92 ? '#059669' :
                    c.accPct >= 82 ? '#1d4ed8' :
                    c.accPct >= 70 ? '#d97706' : '#dc2626'
                  } />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Detailed table */}
          <div style={{ overflowX: 'auto', marginTop: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Class','Full Name','Sensitivity (Recall) %','Specificity %','Precision %','F1','Bal. Acc %','n','Trend','Risk','Stat. Tier','Domain Notes'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', background: '#f9fafb',
                      borderBottom: '2px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#6b7280',
                      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((c, i) => {
                  const tier    = perfTier(c.f1)
                  const trend   = trends[c.key]
                  const sensi   = c.recall ?? c.accPct
                  const isAlert = (c.risk === 'critical' || c.risk === 'high') && sensi < 80
                  const col = v => v >= 80 ? '#059669' : v >= 65 ? '#d97706' : '#dc2626'
                  return (
                    <tr key={i} style={{ background: isAlert ? '#fff7f7' : i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace', fontSize: 12 }}>
                        {isAlert && <span style={{ marginRight: 4 }}>⚠</span>}{c.key}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 500 }}>{c.name}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 700, color: col(sensi) }}>
                        {sensi}%
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 600,
                        color: c.specificity != null ? col(c.specificity) : '#d1d5db' }}>
                        {c.specificity != null ? `${c.specificity}%` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 600,
                        color: c.precision != null ? col(c.precision) : '#d1d5db' }}>
                        {c.precision != null ? `${c.precision}%` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 700,
                        color: c.f1 != null ? (c.f1 >= 0.80 ? '#059669' : c.f1 >= 0.65 ? '#d97706' : '#dc2626') : '#d1d5db' }}>
                        {c.f1 != null ? c.f1.toFixed(3) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 600,
                        color: c.balanced_acc != null ? col(c.balanced_acc) : '#d1d5db' }}>
                        {c.balanced_acc != null ? `${c.balanced_acc}%` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', color: '#9ca3af' }}>
                        {c.support ?? '—'}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 12,
                        color: trend ? (trend.delta > 0 ? '#059669' : trend.delta < -0.5 ? '#dc2626' : '#6b7280') : '#d1d5db' }}>
                        {trend ? `${trend.delta > 0 ? '▲' : trend.delta < -0.5 ? '▼' : '→'} ${trend.delta > 0 ? '+' : ''}${trend.delta}%` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                        <span style={{ background: RISK_BG[c.risk], color: RISK_COLOR[c.risk],
                          padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
                          {c.risk}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                        {tier
                          ? <span style={{ background: tier.bg, color: tier.color, padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{tier.label}</span>
                          : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', color: '#6b7280', maxWidth: 260, fontSize: 12 }}>
                        {c.note}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Class tier summary */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            {[
              { label: 'Strong F1 (≥ 0.90)',    count: classes.filter(c => c.f1 != null ? c.f1 >= 0.90 : c.accPct >= 90).length, color: '#059669', bg: '#f0fdf4' },
              { label: 'Moderate F1 (0.75–0.89)',count: classes.filter(c => c.f1 != null ? c.f1 >= 0.75 && c.f1 < 0.90 : c.accPct >= 75 && c.accPct < 90).length, color: '#1d4ed8', bg: '#eff6ff' },
              { label: 'Weak F1 (0.60–0.74)',    count: classes.filter(c => c.f1 != null ? c.f1 >= 0.60 && c.f1 < 0.75 : c.accPct >= 60 && c.accPct < 75).length, color: '#d97706', bg: '#fffbeb' },
              { label: 'Poor F1 (< 0.60)',       count: classes.filter(c => c.f1 != null ? c.f1 < 0.60  : c.accPct < 60).length,  color: '#dc2626', bg: '#fef2f2' },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{ background: bg, border: `1px solid ${color}22`, borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color }}>{count}</span>
                <span style={{ fontSize: 11, color, fontWeight: 500 }}>{label}</span>
              </div>
            ))}
          </div>
        </Sec>
      )}

      {/* ── Federation Summary ── */}
      <Sec title="Federation Summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Institutions', value: nodeCount },
            { label: 'Rounds', value: `${job.current_round || totalRounds} / ${totalRounds}` },
            { label: 'Algorithm', value: 'FedAvg' },
            { label: 'Architecture', value: archLabel },
            { label: 'Dataset', value: job.dataset },
            duration != null && { label: 'Wall-clock time', value: `${duration} min` },
          ].filter(Boolean).map(({ label, value }) => (
            <div key={label} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{label}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{value}</div>
            </div>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#6b7280', lineHeight: 1.7 }}>
          All model weights were aggregated server-side using FedAvg. No raw patient data or imaging left participating institutions at any point.
          Each node contributed only locally computed gradient updates, preserving patient privacy in compliance with data governance requirements.
        </p>
      </Sec>

      {/* ── Recommendations ── */}
      <Sec title="Recommendations">
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {recs.map((r, i) => (
            <li key={i} style={{ marginBottom: 10, fontSize: 13, color: '#374151', lineHeight: 1.7 }}>{r}</li>
          ))}
        </ol>
      </Sec>

      {/* ── Methodology ── */}
      <Sec title="Methodology">
        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
          <strong>Model:</strong> {archLabel} trained via Federated Averaging (McMahan et al., 2017).{' '}
          <strong>Dataset:</strong> {ds?.full || job.dataset}.{' '}
          <strong>Rounds:</strong> {totalRounds} global rounds
          {job.local_epochs ? ` × ${job.local_epochs} local epoch${job.local_epochs !== 1 ? 's' : ''}` : ''}.{' '}
          {job.dp_enabled
            ? `Differential privacy applied (ε = ${job.dp_epsilon_spent ?? job.dp_epsilon}, δ = ${job.dp_delta}, σ = ${job.dp_noise_multiplier}).`
            : 'No differential privacy applied in this study.'}
          {job.confidence_intervals?.f1 && ` F1 macro 95% CI: [${(job.confidence_intervals.f1.ci_lower).toFixed(3)} – ${(job.confidence_intervals.f1.ci_upper).toFixed(3)}].`}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: '#9ca3af' }}>
          Study ID: {job.study_id || job.id} · Completed: {job.completed_at ? new Date(job.completed_at).toLocaleString() : '—'}
        </p>
      </Sec>

      {/* ── Cite / Methods Paragraph ── */}
      {(() => {
        const ciAcc = job.confidence_intervals?.accuracy
        const paragraph = [
          `We trained a ${archLabel} classifier using Federated Averaging (McMahan et al., 2017) [CITATION] across ${nodeCount} geographically distributed institution${nodeCount !== 1 ? 's' : ''}.`,
          `No raw patient data or imaging was transferred between sites; only locally computed model weight updates were aggregated at the central server using FedAvg, preserving patient privacy in compliance with data protection requirements.`,
          `Training comprised ${totalRounds} global communication round${totalRounds !== 1 ? 's' : ''}${job.local_epochs ? ` with ${job.local_epochs} local epoch${job.local_epochs !== 1 ? 's' : ''} per round per institution` : ''}.`,
          ds ? `The model was evaluated on the ${ds.full} (${ds.domain}; task: ${ds.task}).` : job.dataset ? `The model was evaluated on the ${job.dataset} dataset.` : '',
          job.dp_enabled
            ? `Differential privacy was applied to each model update using the Gaussian mechanism with noise multiplier σ = ${job.dp_noise_multiplier}, providing (ε = ${job.dp_epsilon_spent ?? job.dp_epsilon}, δ = ${job.dp_delta})-DP under the Rényi differential privacy framework (Mironov, 2017) [CITATION].`
            : '',
          `Performance was evaluated using micro accuracy, macro-F1, weighted-F1, per-class sensitivity (recall), specificity, and balanced accuracy.`,
          `Ninety-five percent confidence intervals were estimated via bootstrap resampling (n = 1,000 iterations).`,
          cohen_kappa != null ? `Inter-rater agreement between model predictions and ground truth labels was κ = ${cohen_kappa.toFixed(3)} (${cohen_kappa >= 0.8 ? 'almost perfect' : cohen_kappa >= 0.6 ? 'substantial' : 'moderate'} agreement, Landis & Koch, 1977 [CITATION]).` : '',
          `The federated model achieved ${(accuracy * 100).toFixed(1)}% micro accuracy`,
          ciAcc ? ` (95% CI: ${(ciAcc.ci_lower * 100).toFixed(1)}%–${(ciAcc.ci_upper * 100).toFixed(1)}%)` : '',
          macro_f1 != null ? `, macro-F1 = ${macro_f1.toFixed(3)}, weighted-F1 = ${weighted_f1?.toFixed(3) ?? '—'}` : '',
          baseline != null
            ? `, compared with the published centralised benchmark of ${(baseline * 100).toFixed(1)}% for ${archLabel} on this dataset.`
            : '.',
          `All model weights were trained exclusively on local institutional data and aggregated without accessing individual patient records.`,
          `[Replace bracketed citations with appropriate references for your submission. This paragraph is intended as a draft for the Methods section.]`,
        ].filter(Boolean).join(' ')

        return (
          <Sec title="Methods Paragraph (Draft for Publication)">
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 18px', position: 'relative', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#1e293b', lineHeight: 1.85, fontFamily: 'Georgia, serif' }}>
                {paragraph}
              </p>
              <button
                onClick={() => { navigator.clipboard.writeText(paragraph).catch(() => {}) }}
                style={{ position: 'absolute', top: 12, right: 12, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                  background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Copy
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
              Review and adapt before submission. Replace [CITATION] placeholders with appropriate references.
              This paragraph covers model choice, FL protocol, privacy, evaluation metrics, and results — standard Methods section requirements for medical AI papers.
            </p>
          </Sec>
        )
      })()}

    </div>
  )
}
