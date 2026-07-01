import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app';

const S = {
  wrap:   { fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif' },
  card:   { background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14, padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: 16 },
  h1:     { fontSize: 20, fontWeight: 700, color: '#1D1D1F', letterSpacing: '-0.02em', marginBottom: 4 },
  sub:    { fontSize: 13, color: '#6E6E73', marginBottom: 20 },
  label:  { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' },
  input:  { width: '100%', padding: '8px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, color: '#1C1C1E', background: '#fff', boxSizing: 'border-box', outline: 'none' },
  btnPrimary: { padding: '8px 20px', background: '#007AFF', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '8px 18px', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnDanger: { padding: '6px 14px', background: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  tag: (color) => ({ background: color+'18', color, border: `1px solid ${color}40`, padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600 }),
  row: { display: 'flex', gap: 12, marginBottom: 14 },
  col: { flex: 1 },
  error: { background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginTop: 10 },
  success: { background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginTop: 10 },
};

function ConnectorBadge({ type }) {
  const cfg = type === 'redcap'
    ? { label: 'REDCap', color: '#7C3AED' }
    : type === 'openneuro'
    ? { label: 'OpenNeuro', color: '#059669' }
    : { label: 'OMOP CDM', color: '#0EA5E9' };
  return <span style={S.tag(cfg.color)}>{cfg.label}</span>;
}

// ── REDCap Setup Wizard ───────────────────────────────────────────────────────

function REDCapWizard({ session, onSaved, onCancel }) {
  const [step,      setStep]    = useState(1);   // 1=credentials, 2=fields, 3=done
  const [url,       setUrl]     = useState('');
  const [token,     setToken]   = useState('');
  const [name,      setName]    = useState('');
  const [testing,   setTesting] = useState(false);
  const [projInfo,  setProjInfo]= useState(null);
  const [metadata,  setMeta]    = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [featureFields, setFeatureFields] = useState([]);
  const [labelField, setLabelField] = useState('');
  const [importing, setImporting] = useState(false);
  const [result,    setResult]  = useState(null);
  const [err,       setErr]     = useState('');

  const authH = { Authorization: `Bearer ${session?.access_token}` };

  const testConn = async () => {
    setTesting(true); setErr('');
    try {
      const r = await fetch(`${API}/integrations/redcap/test`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, token }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.detail || 'Connection failed'); return; }
      setProjInfo(d);
      if (!name) setName(d.project_title || 'REDCap Study');
      // fetch metadata
      setLoadingMeta(true);
      const mr = await fetch(`${API}/integrations/redcap/metadata`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, token }),
      });
      const md = await mr.json();
      if (mr.ok) setMeta(md);
      setLoadingMeta(false);
      setStep(2);
    } catch (e) { setErr(e.message); }
    finally { setTesting(false); }
  };

  const importData = async () => {
    if (!featureFields.length || !labelField) { setErr('Select at least one feature field and a label field'); return; }
    setImporting(true); setErr('');
    try {
      const r = await fetch(`${API}/integrations/redcap/import`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, token, feature_fields: featureFields, label_field: labelField, name }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.detail || 'Import failed'); return; }
      setResult(d); setStep(3);
      onSaved && onSaved(d);
    } catch (e) { setErr(e.message); }
    finally { setImporting(false); }
  };

  const numericFields = metadata.filter(f => ['text','slider','calc'].includes(f.field_type));
  const allFields     = metadata;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <ConnectorBadge type="redcap"/>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#1D1D1F' }}>Connect REDCap</span>
      </div>

      {step === 1 && (
        <>
          <div style={{ ...S.row, flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={S.label}>REDCap Instance URL</label>
              <input style={S.input} placeholder="https://redcap.yourhospital.org" value={url} onChange={e=>setUrl(e.target.value)}/>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>The base URL of your REDCap installation (not including /api/)</div>
            </div>
            <div>
              <label style={S.label}>API Token</label>
              <input style={S.input} type="password" placeholder="Your REDCap project API token" value={token} onChange={e=>setToken(e.target.value)}/>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Generate in REDCap: My Projects → API → Generate Token</div>
            </div>
            <div>
              <label style={S.label}>Connection Name</label>
              <input style={S.input} placeholder="e.g. Cardiology Registry 2024" value={name} onChange={e=>setName(e.target.value)}/>
            </div>
          </div>
          {err && <div style={S.error}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button style={S.btnPrimary} onClick={testConn} disabled={testing || !url || !token}>
              {testing ? 'Testing…' : 'Test & Connect'}
            </button>
            <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={S.success}>
            ✓ Connected to <strong>{projInfo?.project_title}</strong> (ID: {projInfo?.project_id})
            {projInfo?.record_count && <> · {projInfo.record_count} records</>}
          </div>

          {loadingMeta
            ? <div style={{ color: '#6E6E73', fontSize: 13, margin: '12px 0' }}>Loading field list…</div>
            : (
              <div style={{ marginTop: 14 }}>
                <div style={{ ...S.row, gap: 20 }}>
                  <div style={S.col}>
                    <label style={S.label}>Feature Fields (numeric)</label>
                    <div style={{ border: '1.5px solid #E5E7EB', borderRadius: 8, maxHeight: 200, overflowY: 'auto', padding: 8 }}>
                      {numericFields.length === 0
                        ? <div style={{ fontSize: 12, color: '#9CA3AF' }}>No numeric fields detected</div>
                        : numericFields.map(f => (
                          <label key={f.field_name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0', cursor: 'pointer', fontSize: 12, color: '#374151' }}>
                            <input type="checkbox" checked={featureFields.includes(f.field_name)}
                              onChange={e => setFeatureFields(prev => e.target.checked ? [...prev, f.field_name] : prev.filter(x=>x!==f.field_name))}/>
                            <span><strong>{f.field_name}</strong> {f.field_label && <span style={{ color: '#9CA3AF' }}>— {f.field_label}</span>}</span>
                          </label>
                        ))
                      }
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{featureFields.length} selected</div>
                  </div>
                  <div style={S.col}>
                    <label style={S.label}>Label Field (classification target)</label>
                    <select style={S.input} value={labelField} onChange={e=>setLabelField(e.target.value)}>
                      <option value="">— Select label field —</option>
                      {allFields.map(f => <option key={f.field_name} value={f.field_name}>{f.field_name} {f.field_label ? `— ${f.field_label}` : ''}</option>)}
                    </select>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                      Values in this field become class labels for FL training
                    </div>
                  </div>
                </div>
              </div>
            )
          }
          {err && <div style={S.error}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button style={S.btnPrimary} onClick={importData} disabled={importing}>
              {importing ? 'Importing…' : `Import ${featureFields.length ? `(${featureFields.length} features)` : 'Data'}`}
            </button>
            <button style={S.btnSecondary} onClick={() => setStep(1)}>Back</button>
            <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}

      {step === 3 && result && (
        <div style={S.success}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>✓ REDCap data imported successfully</div>
          <div>{result.rows} records · {result.features} features · {result.classes} classes ({result.class_names?.join(', ')})</div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#166534' }}>
            Dataset ID: <code>{result.dataset_id}</code> — available as a dataset source in Launch
          </div>
        </div>
      )}
    </div>
  );
}

// ── OMOP Setup Wizard ─────────────────────────────────────────────────────────

function OMOPWizard({ session, onSaved, onCancel }) {
  const [step,      setStep]    = useState(1);  // 1=upload, 2=scenario, 3=done
  const [files,     setFiles]   = useState([]);
  const [validating,setValidating]=useState(false);
  const [validation,setValidation]=useState(null);
  const [scenarios, setScenarios]=useState([]);
  const [scenario,  setScenario]=useState('diabetes_classification');
  const [name,      setName]    = useState('OMOP Import');
  const [importing, setImporting]=useState(false);
  const [result,    setResult]  = useState(null);
  const [err,       setErr]     = useState('');

  const authH = { Authorization: `Bearer ${session?.access_token}` };

  useEffect(() => {
    fetch(`${API}/integrations/omop/scenarios`, { headers: authH })
      .then(r => r.json())
      .then(d => Array.isArray(d) && setScenarios(d))
      .catch(() => {});
  }, []);

  const validateFiles = async () => {
    if (!files.length) { setErr('Select at least one OMOP CSV file'); return; }
    setValidating(true); setErr('');
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const r = await fetch(`${API}/integrations/omop/validate`, {
        method: 'POST', headers: authH, body: fd,
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.detail || 'Validation failed'); return; }
      setValidation(d);
      setStep(2);
    } catch (e) { setErr(e.message); }
    finally { setValidating(false); }
  };

  const importData = async () => {
    setImporting(true); setErr('');
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('scenario', scenario);
      fd.append('name', name);
      const r = await fetch(`${API}/integrations/omop/import`, {
        method: 'POST', headers: authH, body: fd,
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.detail || 'Import failed'); return; }
      setResult(d); setStep(3);
      onSaved && onSaved(d);
    } catch (e) { setErr(e.message); }
    finally { setImporting(false); }
  };

  const allValid = validation && Object.values(validation).every(v => v.valid);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <ConnectorBadge type="omop"/>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#1D1D1F' }}>Connect OMOP CDM</span>
      </div>

      {step === 1 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Upload OMOP CDM CSV Tables</label>
            <div style={{ border: '2px dashed #E5E7EB', borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: '#FAFAFA' }}
              onClick={() => document.getElementById('omop-file-input').click()}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
                {files.length ? `${files.length} file(s) selected` : 'Click to select OMOP CSV files'}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                person.csv · condition_occurrence.csv · measurement.csv
              </div>
              <input id="omop-file-input" type="file" multiple accept=".csv" style={{ display: 'none' }}
                onChange={e => setFiles(Array.from(e.target.files))}/>
            </div>
            {files.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {files.map(f => (
                  <span key={f.name} style={{ background: '#EBF5FF', color: '#1D4ED8', border: '1px solid #BFDBFE', padding: '2px 10px', borderRadius: 99, fontSize: 11 }}>
                    📄 {f.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400E', marginBottom: 14 }}>
            <strong>OMOP CDM v5</strong> — Export your tables as CSV from your OMOP database.
            At minimum, the <strong>person</strong> table is required.
            Add <strong>condition_occurrence</strong> for diagnosis-based labels and
            <strong>measurement</strong> for lab/vital features.
          </div>
          {err && <div style={S.error}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button style={S.btnPrimary} onClick={validateFiles} disabled={validating || !files.length}>
              {validating ? 'Validating…' : 'Validate Tables'}
            </button>
            <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {validation && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#1D1D1F' }}>Validation Results</div>
              {Object.entries(validation).map(([fname, v]) => (
                <div key={fname} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #F3F4F6', fontSize: 12 }}>
                  <span style={{ color: v.valid ? '#10B981' : '#EF4444', fontSize: 14 }}>{v.valid ? '✓' : '✗'}</span>
                  <span style={{ fontWeight: 500, color: '#374151' }}>{fname}</span>
                  {v.detected_table && <span style={S.tag('#6B7280')}>{v.detected_table}</span>}
                  {v.missing_required?.length > 0 && (
                    <span style={{ color: '#EF4444' }}>Missing: {v.missing_required.join(', ')}</span>
                  )}
                  {v.error && <span style={{ color: '#EF4444' }}>{v.error}</span>}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Clinical Scenario</label>
            <select style={S.input} value={scenario} onChange={e=>setScenario(e.target.value)}>
              {scenarios.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {scenarios.find(s=>s.key===scenario) && (
              <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 4 }}>
                {scenarios.find(s=>s.key===scenario).description}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Dataset Name</label>
            <input style={S.input} value={name} onChange={e=>setName(e.target.value)}/>
          </div>

          {err && <div style={S.error}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button style={S.btnPrimary} onClick={importData} disabled={importing || !allValid}>
              {importing ? 'Processing…' : 'Build Feature Matrix & Import'}
            </button>
            <button style={S.btnSecondary} onClick={() => setStep(1)}>Back</button>
            <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}

      {step === 3 && result && (
        <div style={S.success}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>✓ OMOP data transformed successfully</div>
          <div>{result.rows} patients · {result.features} features · {result.classes} classes ({result.class_names?.join(', ')})</div>
          {result.feature_names && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#166534' }}>
              Features: {result.feature_names.join(', ')}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: '#166534' }}>
            Dataset ID: <code>{result.dataset_id}</code> — available as a dataset source in Launch
          </div>
        </div>
      )}
    </div>
  );
}

// ── OpenNeuro Wizard ──────────────────────────────────────────────────────────

const MODALITY_OPTIONS = ['', 'MRI', 'fMRI', 'EEG', 'MEG', 'PET'];

function OpenNeuroWizard({ session, onSaved, onCancel }) {
  const [query,       setQuery]      = useState('');
  const [modality,    setModality]   = useState('');
  const [searching,   setSearching]  = useState(false);
  const [datasets,    setDatasets]   = useState([]);
  const [selected,    setSelected]   = useState(null);  // dataset object
  const [panel,       setPanel]      = useState(null);  // 'files' | 'participants'
  const [panelData,   setPanelData]  = useState(null);
  const [panelLoading,setPanelLoading] = useState(false);
  const [saving,      setSaving]     = useState(null);  // dataset_id being saved
  const [saved,       setSaved]      = useState({});    // dataset_id -> true
  const [err,         setErr]        = useState('');

  const authH = { Authorization: `Bearer ${session?.access_token}` };

  const doSearch = async () => {
    setSearching(true); setErr(''); setDatasets([]); setSelected(null); setPanel(null);
    try {
      const params = new URLSearchParams({ q: query, modality });
      const r = await fetch(`${API}/integrations/openneuro/search?${params}`, { headers: authH });
      const d = await r.json();
      if (!r.ok) { setErr(d.detail || 'Search failed'); return; }
      setDatasets(d.datasets || []);
    } catch (e) { setErr(e.message); }
    finally { setSearching(false); }
  };

  const loadFiles = async (ds) => {
    setSelected(ds); setPanel('files'); setPanelData(null); setPanelLoading(true);
    try {
      const r = await fetch(`${API}/integrations/openneuro/dataset/${ds.id}/files?version=${ds.version}`, { headers: authH });
      const d = await r.json();
      setPanelData(d.files || []);
    } catch (e) { setPanelData([]); }
    finally { setPanelLoading(false); }
  };

  const loadParticipants = async (ds) => {
    setSelected(ds); setPanel('participants'); setPanelData(null); setPanelLoading(true);
    try {
      const r = await fetch(`${API}/integrations/openneuro/dataset/${ds.id}/participants?version=${ds.version}`, { headers: authH });
      const d = await r.json();
      setPanelData(d.participants || []);
    } catch (e) { setPanelData([]); }
    finally { setPanelLoading(false); }
  };

  const useForStudy = async (ds) => {
    setSaving(ds.id);
    try {
      const r = await fetch(`${API}/integrations/openneuro/save`, {
        method: 'POST',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: ds.id, dataset_name: ds.name, version: ds.version }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.detail || 'Save failed'); return; }
      setSaved(prev => ({ ...prev, [ds.id]: true }));
      onSaved && onSaved(d);
    } catch (e) { setErr(e.message); }
    finally { setSaving(null); }
  };

  const fmtBytes = (b) => {
    if (!b) return '—';
    if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
  };

  const panelHeaders = panelData && panelData.length > 0 ? Object.keys(panelData[0]) : [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <ConnectorBadge type="openneuro"/>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#1D1D1F' }}>Browse OpenNeuro</span>
      </div>

      <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#166534', marginBottom: 16 }}>
        OpenNeuro datasets are publicly available under open-access licences.
        Each dataset can be used as a real-world neuroimaging partition in your federated study —
        no download required for metadata-only FL experiments.
      </div>

      {/* Search bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...S.input, flex: 2, minWidth: 180 }}
          placeholder="Search datasets (e.g. Alzheimer, autism, stroke)…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
        />
        <select style={{ ...S.input, flex: '0 0 120px' }} value={modality} onChange={e => setModality(e.target.value)}>
          {MODALITY_OPTIONS.map(m => <option key={m} value={m}>{m || 'All modalities'}</option>)}
        </select>
        <button style={S.btnPrimary} onClick={doSearch} disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
        <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
      </div>

      {err && <div style={S.error}>{err}</div>}

      {/* Results table */}
      {datasets.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['Dataset', 'ID', 'Modalities', 'Subjects', 'Downloads', 'Size', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1.5px solid #E5E7EB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datasets.map(ds => (
                <tr key={ds.id} style={{ borderBottom: '1px solid #F3F4F6', background: selected?.id === ds.id ? '#F0FDF4' : 'transparent' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 500, color: '#1D1D1F', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ds.name}>{ds.name}</td>
                  <td style={{ padding: '8px 10px', color: '#6B7280', fontFamily: 'monospace' }}>{ds.id}</td>
                  <td style={{ padding: '8px 10px', color: '#374151' }}>{(ds.modalities || []).join(', ') || '—'}</td>
                  <td style={{ padding: '8px 10px', color: '#374151', textAlign: 'right' }}>{ds.subjects ?? '—'}</td>
                  <td style={{ padding: '8px 10px', color: '#374151', textAlign: 'right' }}>{ds.downloads ?? '—'}</td>
                  <td style={{ padding: '8px 10px', color: '#374151' }}>{fmtBytes(ds.size_bytes)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap' }}>
                      <button style={{ ...S.btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => loadFiles(ds)}>Files</button>
                      <button style={{ ...S.btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => loadParticipants(ds)}>Participants</button>
                      <button
                        style={{ ...S.btnPrimary, padding: '4px 10px', fontSize: 11, background: saved[ds.id] ? '#059669' : '#007AFF' }}
                        onClick={() => useForStudy(ds)}
                        disabled={!!saving || saved[ds.id]}
                      >
                        {saved[ds.id] ? 'Saved' : saving === ds.id ? '…' : 'Use for study'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datasets.length === 0 && !searching && query && !err && (
        <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No datasets found. Try a different query or modality.</div>
      )}

      {/* Detail panel */}
      {selected && panel && (
        <div style={{ border: '1.5px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#1D1D1F' }}>
              {panel === 'files' ? 'Files' : 'Participants'} — <span style={{ fontFamily: 'monospace', fontWeight: 400 }}>{selected.id}</span>
            </div>
            <button style={{ ...S.btnSecondary, padding: '3px 10px', fontSize: 11 }} onClick={() => { setPanel(null); setPanelData(null); }}>Close</button>
          </div>
          {panelLoading && <div style={{ color: '#9CA3AF', fontSize: 12 }}>Loading…</div>}
          {!panelLoading && panelData && panelData.length === 0 && (
            <div style={{ color: '#9CA3AF', fontSize: 12 }}>No data found.</div>
          )}
          {!panelLoading && panelData && panelData.length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: 280, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', position: 'sticky', top: 0 }}>
                    {panelHeaders.map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1.5px solid #E5E7EB', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {panelData.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      {panelHeaders.map(h => (
                        <td key={h} style={{ padding: '5px 8px', color: '#374151', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(row[h] ?? '')}>{row[h] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function DataConnectors({ session }) {
  const [connections, setConnections] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [wizard,      setWizard]      = useState(null);  // 'redcap' | 'omop' | 'openneuro' | null
  const [deleting,    setDeleting]    = useState(null);

  const authH = { Authorization: `Bearer ${session?.access_token}` };

  const loadConnections = () => {
    setLoading(true);
    fetch(`${API}/integrations/connections`, { headers: authH })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setConnections(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(loadConnections, [session?.access_token]);

  const deleteConn = async (id) => {
    setDeleting(id);
    await fetch(`${API}/integrations/connections/${id}`, { method: 'DELETE', headers: authH });
    loadConnections();
    setDeleting(null);
  };

  const handleSaved = () => { setWizard(null); loadConnections(); };

  if (wizard) {
    return (
      <div style={S.wrap}>
        <div style={S.card}>
          {wizard === 'redcap'      && <REDCapWizard     session={session} onSaved={handleSaved} onCancel={() => setWizard(null)}/>}
          {wizard === 'omop'        && <OMOPWizard       session={session} onSaved={handleSaved} onCancel={() => setWizard(null)}/>}
          {wizard === 'openneuro'   && <OpenNeuroWizard  session={session} onSaved={handleSaved} onCancel={() => setWizard(null)}/>}
        </div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ background: 'linear-gradient(135deg,#7C3AED,#0EA5E9)', borderRadius: 10, padding: '6px 14px', color: '#fff', fontWeight: 700, fontSize: 13 }}>CODA</div>
            <div style={S.h1}>Data Connectors</div>
          </div>
          <div style={S.sub}>
            Connect your REDCap project, OMOP CDM database, or browse OpenNeuro public neuroimaging datasets for FL studies — no migration required.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button style={{ ...S.btnSecondary, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setWizard('redcap')}>
            <span style={{ fontWeight: 700, color: '#7C3AED' }}>REDCap</span>
          </button>
          <button style={{ ...S.btnSecondary, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setWizard('omop')}>
            <span style={{ fontWeight: 700, color: '#0EA5E9' }}>OMOP CDM</span>
          </button>
          <button style={{ ...S.btnSecondary, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setWizard('openneuro')}>
            <span style={{ fontWeight: 700, color: '#059669' }}>OpenNeuro</span>
          </button>
        </div>
      </div>

      {/* How it works info strip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { icon: '🔗', title: 'REDCap', desc: 'Connect via API token. Map fields to features + label. Export for FL training.' },
          { icon: '🗄️', title: 'OMOP CDM', desc: 'Upload condition, measurement & person CSV exports. Choose clinical scenario. Auto-build feature matrix.' },
          { icon: '🧠', title: 'OpenNeuro', desc: 'Browse 1,000+ public neuroimaging datasets. Each dataset becomes a simulated FL partition — no raw scan download needed for metadata studies.' },
          { icon: '🚀', title: 'Launch', desc: 'Imported datasets appear in the Launch form as selectable data sources.' },
        ].map(c => (
          <div key={c.title} style={{ flex: '1 1 200px', background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#1D1D1F', marginBottom: 4 }}>{c.title}</div>
            <div style={{ fontSize: 12, color: '#6E6E73', lineHeight: 1.5 }}>{c.desc}</div>
          </div>
        ))}
      </div>

      {/* Connections list */}
      <div style={S.card}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#1D1D1F', marginBottom: 14 }}>
          Saved Connections {connections.length > 0 && <span style={{ color: '#9CA3AF', fontWeight: 400 }}>({connections.length})</span>}
        </div>

        {loading
          ? <div style={{ color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
          : connections.length === 0
            ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: '#9CA3AF' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🔌</div>
                <div style={{ fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>No connections yet</div>
                <div style={{ fontSize: 12, marginBottom: 16 }}>
                  Connect REDCap or OMOP CDM, or browse OpenNeuro public datasets for federated learning.
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button style={S.btnPrimary} onClick={() => setWizard('redcap')}>Connect REDCap</button>
                  <button style={S.btnSecondary} onClick={() => setWizard('omop')}>Connect OMOP</button>
                  <button style={{ ...S.btnSecondary, color: '#059669', fontWeight: 600 }} onClick={() => setWizard('openneuro')}>Browse OpenNeuro</button>
                </div>
              </div>
            )
            : connections.map(c => {
              const cfg = c.config || {};
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: c.connection_type === 'redcap' ? '#F3E8FF' : c.connection_type === 'openneuro' ? '#ECFDF5' : '#E0F2FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                    {c.connection_type === 'redcap' ? '🔗' : c.connection_type === 'openneuro' ? '🧠' : '🗄️'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#1D1D1F' }}>{c.name}</span>
                      <ConnectorBadge type={c.connection_type}/>
                      <span style={S.tag(c.status === 'active' ? '#10B981' : '#EF4444')}>{c.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6E6E73' }}>
                      {c.connection_type === 'redcap'      && cfg.url && <>{cfg.url}</>}
                      {c.connection_type === 'omop'        && cfg.scenario && <>Scenario: {cfg.scenario} · Tables: {cfg.tables_uploaded?.join(', ')}</>}
                      {c.connection_type === 'openneuro'   && cfg.dataset_id && <>OpenNeuro: <code style={{ fontSize: 11 }}>{cfg.dataset_id}</code>{cfg.version && <> · v{cfg.version}</>}</>}
                      {c.connection_type !== 'openneuro' && cfg.dataset_id && <> · Dataset: <code style={{ fontSize: 11 }}>{cfg.dataset_id?.slice(0,8)}</code></>}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                      Created {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <button style={S.btnDanger} onClick={() => deleteConn(c.id)} disabled={deleting === c.id}>
                    {deleting === c.id ? '…' : 'Remove'}
                  </button>
                </div>
              );
            })
        }
      </div>

      {/* Footer note */}
      <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 8, lineHeight: 1.6 }}>
        <strong>OMOP CDM v5 supported.</strong> Compatible with EHDEN, NHS Secure Data Environments, and any institution using the OHDSI tools stack.
        REDCap connector tested against REDCap 12+. Your API token is used only for the import — it is not stored in plain text after connection.
        <strong> OpenNeuro</strong> datasets are publicly available under open data licences; raw scans are not downloaded by the platform.
      </div>
    </div>
  );
}
