import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://undosatech-production.up.railway.app';

const DOC_TABS = [
  { key: 'dpia',        label: 'GDPR DPIA',           icon: '🛡️' },
  { key: 'ig_register', label: 'IG Data Flow Register', icon: '📋' },
  { key: 'model_card',  label: 'Model Card',           icon: '🤖' },
  { key: 'dua',         label: 'Data Use Agreement',   icon: '✍️' },
];

export default function CompliancePack({ studyId, session }) {
  const [pack,    setPack]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [activeDoc, setActiveDoc] = useState('dpia');
  const [copied,  setCopied]  = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!studyId || !session?.access_token) return;
    setLoading(true);
    setError(null);
    fetch(`${API}/studies/${studyId}/compliance-pack`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setPack(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [studyId, session?.access_token]);

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const r = await fetch(`${API}/studies/${studyId}/compliance-pack/download`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ARIA_CompliancePack_${pack?.study_ref || studyId.slice(0,8).toUpperCase()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Download failed: ' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleCopy = () => {
    const content = pack?.documents?.[activeDoc]?.content || '';
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadDoc = () => {
    const doc = pack?.documents?.[activeDoc];
    if (!doc) return;
    const blob = new Blob([doc.content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = doc.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const S = {
    wrap: { fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif' },
    header: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 20,
    },
    badge: {
      background: 'linear-gradient(135deg,#007AFF,#0055D4)',
      color: '#fff', padding: '4px 12px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    },
    meta: { fontSize: 13, color: '#6E6E73', marginTop: 4 },
    tabRow: {
      display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap',
    },
    tab: active => ({
      padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: active ? 600 : 500,
      cursor: 'pointer', border: active ? '1.5px solid #007AFF' : '1.5px solid #E5E7EB',
      background: active ? '#EBF5FF' : '#fff', color: active ? '#007AFF' : '#374151',
      transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 5,
    }),
    actions: {
      display: 'flex', gap: 8, marginBottom: 14, justifyContent: 'flex-end', flexWrap: 'wrap',
    },
    btn: (primary) => ({
      padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
      cursor: 'pointer', border: 'none',
      background: primary ? '#007AFF' : '#F3F4F6',
      color: primary ? '#fff' : '#374151',
      transition: 'all 0.15s',
    }),
    docBox: {
      background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10,
      padding: '18px 20px', fontFamily: '"SF Mono","Cascadia Code","Fira Code",monospace',
      fontSize: 11.5, lineHeight: 1.75, color: '#1C1C1E',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      maxHeight: 520, overflowY: 'auto',
    },
    statusRow: {
      display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18,
    },
    statusCard: {
      flex: '1 1 180px', background: '#fff', border: '1px solid #E5E7EB',
      borderRadius: 10, padding: '12px 14px',
    },
    statusLabel: { fontSize: 11, color: '#6E6E73', marginBottom: 4, fontWeight: 500 },
    statusValue: { fontSize: 13, color: '#1C1C1E', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 },
    checkGreen: { color: '#10B981', fontSize: 15 },
  };

  if (loading) return (
    <div style={{ ...S.wrap, padding: 40, textAlign: 'center', color: '#6E6E73', fontSize: 14 }}>
      Generating compliance pack…
    </div>
  );

  if (error) return (
    <div style={{ ...S.wrap, padding: 24, color: '#DC2626', fontSize: 13 }}>
      Failed to load compliance pack: {error}
    </div>
  );

  if (!pack) return null;

  const docs = pack.documents || {};
  const genDate = pack.generated_at
    ? new Date(pack.generated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={S.badge}>ARIA</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#1C1C1E' }}>
              Compliance Pack — {pack.study_name}
            </span>
          </div>
          <div style={S.meta}>
            Ref: {pack.study_ref} &nbsp;·&nbsp; Generated {genDate}
          </div>
        </div>
        <button
          style={S.btn(true)}
          onClick={handleDownloadZip}
          disabled={downloading}
        >
          {downloading ? 'Preparing…' : '⬇ Download All (ZIP)'}
        </button>
      </div>

      {/* Status cards */}
      <div style={S.statusRow}>
        {DOC_TABS.map(d => (
          <div key={d.key} style={S.statusCard}>
            <div style={S.statusLabel}>{d.label}</div>
            <div style={S.statusValue}>
              <span style={S.checkGreen}>✓</span> Generated
            </div>
          </div>
        ))}
      </div>

      {/* Document tabs */}
      <div style={S.tabRow}>
        {DOC_TABS.map(d => (
          <button key={d.key} style={S.tab(activeDoc === d.key)} onClick={() => setActiveDoc(d.key)}>
            {d.icon} {d.label}
          </button>
        ))}
      </div>

      {/* Document actions */}
      <div style={S.actions}>
        <button style={S.btn(false)} onClick={handleCopy}>
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
        <button style={S.btn(false)} onClick={handleDownloadDoc}>
          ⬇ Download .txt
        </button>
      </div>

      {/* Document content */}
      <div style={S.docBox}>
        {docs[activeDoc]?.content || 'Document not available.'}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#9CA3AF', textAlign: 'right' }}>
        Auto-generated by ARIA — UndosaTech NHS Research IG & Compliance Manager
      </div>
    </div>
  );
}
