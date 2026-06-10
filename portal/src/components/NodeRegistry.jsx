// portal/src/components/NodeRegistry.jsx

import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "https://undosatech-production.up.railway.app";

// ── Shared styles ─────────────────────────────────────────────────────────────
const btn = (bg, text) => ({
  padding: "9px 18px", borderRadius: 8, border: "none",
  background: bg, color: text || (bg === "#22d3a5" ? "#0f172a" : "#e2e8f0"),
  fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s", fontSize: 13,
});

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
  backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
  justifyContent: "center", zIndex: 1000, padding: 20,
};

const boxStyle = {
  background: "linear-gradient(145deg, #0f172a, #1e293b)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16, padding: "28px", width: "100%",
  maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
};

const label = { display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" };

const inputStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 8, boxSizing: "border-box",
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  color: "#e2e8f0", fontSize: 13, outline: "none",
};

// ── Connectivity badge ────────────────────────────────────────────────────────
function ConnectivityBadge({ connectivity, status }) {
  const map = {
    online:      { dot: "#22d3a5", label: "Online",      bg: "rgba(34,211,165,0.12)",  text: "#22d3a5" },
    degraded:    { dot: "#f59e0b", label: "Degraded",    bg: "rgba(245,158,11,0.12)",  text: "#f59e0b" },
    unreachable: { dot: "#ef4444", label: "Offline",     bg: "rgba(239,68,68,0.12)",   text: "#ef4444" },
    pending:     { dot: "#a78bfa", label: "Pending",     bg: "rgba(167,139,250,0.12)", text: "#a78bfa" },
    suspended:   { dot: "#6b7280", label: "Suspended",   bg: "rgba(107,114,128,0.12)", text: "#6b7280" },
  };
  const key = status === "pending" ? "pending" : status === "suspended" ? "suspended" : connectivity;
  const c = map[key] || map.unreachable;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 99, background: c.bg, color: c.text, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.dot, boxShadow: key === "online" ? `0 0 6px ${c.dot}` : "none", animation: key === "online" ? "pulse-dot 2s ease-in-out infinite" : "none" }} />
      {c.label}
    </span>
  );
}

// ── Node card ─────────────────────────────────────────────────────────────────
function NodeCard({ node, selected, onToggle, onDetail }) {
  const selectable = node.status === "active";
  const lastSeen = node.last_heartbeat ? new Date(node.last_heartbeat).toLocaleString() : "Never";
  return (
    <div style={{
      background: selected
        ? "linear-gradient(135deg, rgba(34,211,165,0.07), rgba(15,23,42,0.95))"
        : "rgba(15,23,42,0.85)",
      border: selected ? "1px solid rgba(34,211,165,0.4)" : "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12, padding: "18px 20px",
      cursor: "pointer", opacity: selectable ? 1 : 0.75,
      transition: "all 0.2s ease", position: "relative", backdropFilter: "blur(8px)",
    }}>
      {/* Checkbox */}
      {selectable && (
        <div onClick={() => onToggle(node.node_id)} style={{ position: "absolute", top: 16, right: 16, width: 18, height: 18, borderRadius: 5, border: selected ? "2px solid #22d3a5" : "2px solid rgba(255,255,255,0.2)", background: selected ? "#22d3a5" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
          {selected && <span style={{ color: "#0f172a", fontSize: 11, fontWeight: 700 }}>✓</span>}
        </div>
      )}

      {/* Header row */}
      <div onClick={() => onDetail(node)} style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <ConnectivityBadge connectivity={node.connectivity} status={node.status} />
          {node.gpu_available && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", background: "rgba(168,85,247,0.15)", color: "#c084fc", padding: "2px 7px", borderRadius: 99, textTransform: "uppercase" }}>GPU</span>}
        </div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3 }}>{node.institution_name}</h3>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>{node.institution_domain} · <span style={{ fontFamily: "monospace", fontSize: 11 }}>{node.node_id}</span></p>
      </div>

      {node.tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
          {node.tags.map(t => <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "rgba(99,102,241,0.12)", color: "#818cf8", fontWeight: 500 }}>{t}</span>)}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11, color: "#64748b" }}>
        <span>📊 {node.max_samples?.toLocaleString() ?? "—"} max samples</span>
        <span>🕐 {lastSeen}</span>
        <span style={{ gridColumn: "1 / -1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          🧠 {node.supported_models?.slice(0, 3).join(", ")}{node.supported_models?.length > 3 && ` +${node.supported_models.length - 3}`}
        </span>
      </div>

      {/* Admin badge for pending */}
      {node.status === "pending" && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#a78bfa", background: "rgba(167,139,250,0.1)", borderRadius: 6, padding: "4px 10px", display: "inline-block" }}>
          ⏳ Awaiting admin approval — click to review
        </div>
      )}
    </div>
  );
}

// ── Node detail modal ─────────────────────────────────────────────────────────
function NodeDetailModal({ nodeId, session, isAdmin, onClose, onApprove, onSuspend }) {
  const [node, setNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [invBusy, setInvBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nodeRes, invRes] = await Promise.all([
        fetch(`${API}/nodes/${nodeId}`, { headers: { Authorization: `Bearer ${session?.access_token}` } }),
        fetch(`${API}/nodes/${nodeId}/invitations`, { headers: { Authorization: `Bearer ${session?.access_token}` } }),
      ]);
      if (!nodeRes.ok) throw new Error(`HTTP ${nodeRes.status}`);
      setNode(await nodeRes.json());
      setInvitations(invRes.ok ? await invRes.json() : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [nodeId, session]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action) => {
    setActionBusy(true); setActionMsg(null);
    try {
      const res = await fetch(`${API}/nodes/${nodeId}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || `Failed`); }
      const d = await res.json();
      setActionMsg(`✓ Node ${d.status}`);
      if (action === "approve") onApprove?.();
      if (action === "suspend") onSuspend?.();
      await load();
    } catch (e) {
      setActionMsg(`✗ ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const respondInvitation = async (invId, action, reason = "") => {
    setInvBusy(invId);
    try {
      const res = await fetch(`${API}/invitations/${invId}/${action}`, {
        method: action === "withdraw" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: action !== "withdraw" ? JSON.stringify({ reason }) : undefined,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Failed"); }
      await load();
    } catch (e) {
      setActionMsg(`✗ ${e.message}`);
    } finally {
      setInvBusy(null);
    }
  };

  const hbRow = (hb) => (
    <div key={hb.id} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, color: "#94a3b8" }}>
      <span style={{ flexShrink: 0 }}>{new Date(hb.recorded_at).toLocaleTimeString()}</span>
      <span style={{ color: hb.training_active ? "#38bdf8" : "#64748b" }}>{hb.training_active ? "⚡ Training" : "● Idle"}</span>
      <span>{hb.latency_ms != null ? `${hb.latency_ms}ms` : "—"}</span>
      {hb.current_study_id && <span style={{ fontFamily: "monospace", fontSize: 10 }}>{hb.current_study_id.slice(0, 8)}</span>}
    </div>
  );

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...boxStyle, maxWidth: 560 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, color: "#e2e8f0", fontSize: 18 }}>Node Details</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading…</div>}
        {error && <div style={{ color: "#fca5a5", textAlign: "center", padding: 20 }}>Error: {error}</div>}

        {node && !loading && <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <ConnectivityBadge connectivity={node.connectivity} status={node.status} />
            {node.gpu_available && <span style={{ fontSize: 11, background: "rgba(168,85,247,0.15)", color: "#c084fc", padding: "2px 8px", borderRadius: 99 }}>GPU</span>}
          </div>

          <h3 style={{ margin: "0 0 4px", color: "#e2e8f0", fontSize: 16 }}>{node.institution_name}</h3>
          <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: 13 }}>{node.institution_domain}</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              ["Node ID", node.node_id],
              ["Contact", node.contact_email],
              ["Host", `${node.host}:${node.port}`],
              ["Max Samples", node.max_samples?.toLocaleString() ?? "Unlimited"],
              ["Registered", new Date(node.registered_at).toLocaleDateString()],
              ["Approved", node.approved_at ? new Date(node.approved_at).toLocaleDateString() : "Pending"],
              ["Last Heartbeat", node.last_heartbeat ? new Date(node.last_heartbeat).toLocaleString() : "Never"],
              ["Status", node.status],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{k}</div>
                <div style={{ fontSize: 12, color: "#e2e8f0", fontFamily: k === "Node ID" || k === "Host" ? "monospace" : "inherit", wordBreak: "break-all" }}>{v}</div>
              </div>
            ))}
          </div>

          {node.supported_models?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...label, marginBottom: 8 }}>Supported Models</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {node.supported_models.map(m => <span key={m} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>{m}</span>)}
              </div>
            </div>
          )}

          {/* Heartbeat history */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ ...label, marginBottom: 8 }}>Recent Heartbeats ({node.recent_heartbeats?.length ?? 0})</div>
            {node.recent_heartbeats?.length > 0
              ? <div style={{ maxHeight: 160, overflowY: "auto", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: "4px 12px" }}>
                  {node.recent_heartbeats.map(hbRow)}
                </div>
              : <div style={{ fontSize: 12, color: "#64748b" }}>No heartbeats recorded yet.</div>
            }
          </div>

          {/* Study invitations */}
          {invitations.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ ...label, marginBottom: 8 }}>Study Invitations ({invitations.length})</div>
              <div style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                {invitations.map(inv => {
                  const statusColors = {
                    pending:   { bg: "rgba(251,191,36,0.1)",  text: "#fbbf24" },
                    accepted:  { bg: "rgba(34,211,165,0.1)",  text: "#22d3a5" },
                    declined:  { bg: "rgba(239,68,68,0.1)",   text: "#f87171" },
                    withdrawn: { bg: "rgba(100,116,139,0.1)", text: "#64748b" },
                  };
                  const sc = statusColors[inv.status] || statusColors.pending;
                  return (
                    <div key={inv.id} style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inv.study_name || inv.study_id}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {inv.invited_by_email || "Unknown researcher"} · {new Date(inv.invited_at).toLocaleDateString()}
                        </div>
                        {inv.message && <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", marginTop: 2 }}>"{inv.message}"</div>}
                      </div>
                      <span style={{ padding: "2px 8px", borderRadius: 99, background: sc.bg, color: sc.text, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0 }}>{inv.status}</span>
                      {isAdmin && inv.status === "pending" && (
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <button onClick={() => respondInvitation(inv.id, "accept")} disabled={invBusy === inv.id}
                            style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "rgba(34,211,165,0.15)", color: "#22d3a5", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                            {invBusy === inv.id ? "…" : "Accept"}
                          </button>
                          <button onClick={() => respondInvitation(inv.id, "decline")} disabled={invBusy === inv.id}
                            style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Admin actions */}
          {actionMsg && (
            <div style={{ marginBottom: 12, fontSize: 13, color: actionMsg.startsWith("✓") ? "#22d3a5" : "#fca5a5", background: actionMsg.startsWith("✓") ? "rgba(34,211,165,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${actionMsg.startsWith("✓") ? "rgba(34,211,165,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 8, padding: "8px 12px" }}>
              {actionMsg}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {node.status === "pending" && (
              <button onClick={() => doAction("approve")} disabled={actionBusy} style={{ ...btn("#22d3a5"), flex: 1 }}>
                {actionBusy ? "…" : "✓ Approve Node"}
              </button>
            )}
            {node.status === "active" && (
              <button onClick={() => doAction("suspend")} disabled={actionBusy} style={{ ...btn("rgba(239,68,68,0.12)", "#fca5a5"), flex: 1 }}>
                {actionBusy ? "…" : "Suspend Node"}
              </button>
            )}
            {node.status === "suspended" && (
              <button onClick={() => doAction("approve")} disabled={actionBusy} style={{ ...btn("rgba(34,211,165,0.12)", "#22d3a5"), flex: 1 }}>
                {actionBusy ? "…" : "Reinstate Node"}
              </button>
            )}
            <button onClick={onClose} style={{ ...btn("rgba(255,255,255,0.06)", "#94a3b8"), flex: 1 }}>Close</button>
          </div>
        </>}
      </div>
    </div>
  );
}

// ── Registration modal ────────────────────────────────────────────────────────
function RegisterModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    node_id: "", institution_name: "", institution_domain: "",
    contact_email: "", host: "", port: 8080,
    gpu_available: false, max_samples: "", supported_models: [],
    tags: "", registration_secret: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const ALL_MODELS = ["ResNet-18", "ResNet-50", "ResNet-101", "EfficientNet-B0", "EfficientNet-B4", "ViT-B/16", "Lightweight CNN"];
  const toggleModel = (m) => setForm(f => ({ ...f, supported_models: f.supported_models.includes(m) ? f.supported_models.filter(x => x !== m) : [...f.supported_models, m] }));

  const handleSubmit = async () => {
    setError(null); setLoading(true);
    try {
      const payload = { ...form, port: parseInt(form.port) || 8080, max_samples: form.max_samples ? parseInt(form.max_samples) : null, tags: form.tags.split(",").map(t => t.trim()).filter(Boolean) };
      const res = await fetch(`${API}/nodes/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Registration failed");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => { navigator.clipboard.writeText(result.api_key); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); };

  const field = (lbl, key, type = "text", placeholder = "") => (
    <div style={{ marginBottom: 14 }}>
      <label style={label}>{lbl}</label>
      <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} style={inputStyle} />
    </div>
  );

  if (result) return (
    <div style={overlayStyle}>
      <div style={{ ...boxStyle, maxWidth: 520 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
          <h2 style={{ color: "#22d3a5", margin: "0 0 6px", fontSize: 20 }}>Node Registered!</h2>
          <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>{result.message}</p>
        </div>
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
          <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#fca5a5" }}>⚠️ SAVE THIS API KEY — it will never be shown again</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, fontSize: 11, background: "rgba(0,0,0,0.3)", padding: "8px 10px", borderRadius: 6, color: "#fde68a", wordBreak: "break-all" }}>{result.api_key}</code>
            <button onClick={copyKey} style={{ ...btn("#22d3a5"), flexShrink: 0, padding: "8px 14px", fontSize: 12 }}>{copiedKey ? "✓ Copied" : "Copy"}</button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>Set <code>NODE_API_KEY={result.api_key}</code> in your <code>.env.node</code> file.</p>
        <button onClick={() => { onSuccess(); onClose(); }} style={{ ...btn("#22d3a5"), width: "100%" }}>Done</button>
      </div>
    </div>
  );

  return (
    <div style={overlayStyle}>
      <div style={{ ...boxStyle, maxWidth: 580 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, color: "#e2e8f0", fontSize: 18 }}>Register FL Node</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div style={{ gridColumn: "1 / -1" }}>{field("Node ID *", "node_id", "text", "nhs-kings-001")}</div>
          <div style={{ gridColumn: "1 / -1" }}>{field("Institution Name *", "institution_name", "text", "King's College Hospital NHS Foundation Trust")}</div>
          {field("Domain *", "institution_domain", "text", "kch.nhs.uk")}
          {field("Contact Email *", "contact_email", "email", "research@kch.nhs.uk")}
          {field("Public Host *", "host", "text", "203.0.113.10")}
          {field("Port", "port", "number", "8080")}
          {field("Max Samples", "max_samples", "number", "10000")}
          {field("Tags (comma-separated)", "tags", "text", "ophthalmology, retinal")}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...label, marginBottom: 8 }}>Supported Models</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALL_MODELS.map(m => (
              <button key={m} onClick={() => toggleModel(m)} style={{ padding: "5px 11px", borderRadius: 99, fontSize: 11, cursor: "pointer", border: form.supported_models.includes(m) ? "1px solid #22d3a5" : "1px solid rgba(255,255,255,0.12)", background: form.supported_models.includes(m) ? "rgba(34,211,165,0.12)" : "transparent", color: form.supported_models.includes(m) ? "#22d3a5" : "#64748b", transition: "all 0.15s" }}>{m}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setForm(f => ({ ...f, gpu_available: !f.gpu_available }))} style={{ width: 40, height: 22, borderRadius: 99, border: "none", background: form.gpu_available ? "#22d3a5" : "rgba(255,255,255,0.1)", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
            <span style={{ position: "absolute", top: 3, left: form.gpu_available ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
          </button>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>GPU Available</span>
        </div>
        {field("Registration Secret *", "registration_secret", "password", "Provided by UndosaTech team")}
        {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#fca5a5" }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...btn("rgba(255,255,255,0.08)", "#94a3b8"), flex: 1 }}>Cancel</button>
          <button onClick={handleSubmit} disabled={loading} style={{ ...btn("#22d3a5"), flex: 2 }}>{loading ? "Registering…" : "Register Node"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Setup guide ───────────────────────────────────────────────────────────────
function SetupGuide() {
  const [copied, setCopied] = useState(null);
  const copy = (id, text) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 2000); };

  const codeBlock = (id, code) => (
    <div style={{ position: "relative", marginBottom: 16 }}>
      <pre style={{ margin: 0, padding: "14px 16px", background: "rgba(0,0,0,0.4)", borderRadius: 8, fontSize: 12, color: "#94a3b8", overflowX: "auto", border: "1px solid rgba(255,255,255,0.06)", lineHeight: 1.6 }}>
        <code style={{ color: "#e2e8f0" }}>{code}</code>
      </pre>
      <button onClick={() => copy(id, code)} style={{ position: "absolute", top: 8, right: 8, ...btn("rgba(255,255,255,0.08)", "#94a3b8"), padding: "4px 10px", fontSize: 11 }}>
        {copied === id ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );

  const section = (num, title, children) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(34,211,165,0.15)", color: "#22d3a5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{num}</div>
        <h3 style={{ margin: 0, color: "#e2e8f0", fontSize: 15, fontWeight: 700 }}>{title}</h3>
      </div>
      <div style={{ paddingLeft: 38 }}>{children}</div>
    </div>
  );

  const envTemplate = `NODE_ID=your-institution-001
INSTITUTION_NAME=Your Institution Full Name
INSTITUTION_DOMAIN=youruni.ac.uk
CONTACT_EMAIL=research-it@youruni.ac.uk
NODE_HOST=your.public.ip.or.hostname
NODE_PORT=8080
NODE_REGISTRATION_SECRET=<ask UndosaTech team>
GPU_AVAILABLE=false
MAX_SAMPLES=10000
SUPPORTED_MODELS=ResNet-18,ResNet-50,EfficientNet-B0
TAGS=radiology,pathology`;

  return (
    <div style={{ maxWidth: 700, animation: "fade-in 0.4s ease" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>Institution Setup Guide</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          Deploy an FL node on your institution's infrastructure. Raw patient data never leaves your server —
          only encrypted model weight updates are sent to the orchestrator.
        </p>
      </div>

      <div style={{ background: "rgba(34,211,165,0.06)", border: "1px solid rgba(34,211,165,0.15)", borderRadius: 10, padding: "12px 16px", marginBottom: 28, fontSize: 12, color: "#22d3a5" }}>
        ✓ NHS (.nhs.uk) and university (.ac.uk, .edu) domains are auto-approved — no manual review needed.
        Other domains require admin approval (usually within 24 hours).
      </div>

      {section(1, "Prerequisites", <>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>Your institution's server needs:</p>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#94a3b8", fontSize: 13, lineHeight: 2 }}>
          <li>Docker Engine ≥ 20.10 and Docker Compose ≥ 2.0</li>
          <li>Outbound internet access to <code style={{ color: "#e2e8f0" }}>undosatech-production.up.railway.app</code> (HTTPS port 443)</li>
          <li>A static public IP or hostname (for the orchestrator to route training assignments)</li>
          <li>Port {8080} open for inbound Flower gRPC connections (or your chosen NODE_PORT)</li>
        </ul>
      </>)}

      {section(2, "Create your environment file", <>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>Create a file called <code style={{ color: "#e2e8f0" }}>.env.node</code> (never commit to version control):</p>
        {codeBlock("env", envTemplate)}
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "#64748b" }}>Contact the UndosaTech team at <strong style={{ color: "#94a3b8" }}>contact@undosatech.com</strong> to get your <code>NODE_REGISTRATION_SECRET</code>.</p>
      </>)}

      {section(3, "Download and launch the Docker container", <>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>Download the compose file directly from UndosaTech and start the node:</p>
        {codeBlock("pull", `# Download the compose file
curl -O https://undosatech-production.up.railway.app/node/docker-compose.yml
mv docker-compose.yml docker-compose.node.yml

# Start the node (runs in background)
docker compose -f docker-compose.node.yml up -d`)}
      </>)}

      {section(4, "Verify and monitor", <>
        {codeBlock("logs", `# Watch startup logs (look for "✓ Registered" and "Heartbeat thread started")
docker compose -f docker-compose.node.yml logs -f

# Check the container is healthy
docker ps --filter name=undosatech-fl-node`)}
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#94a3b8" }}>
          Once registered, the node appears in the <strong style={{ color: "#e2e8f0" }}>Nodes</strong> tab within 30 seconds.
          If your domain requires manual approval, status shows <span style={{ color: "#a78bfa" }}>Pending</span> until an admin approves it.
        </p>
      </>)}

      {section(5, "Security notes", <>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#94a3b8", fontSize: 13, lineHeight: 2 }}>
          <li><strong style={{ color: "#e2e8f0" }}>Raw data never leaves your server.</strong> Only model weight updates travel to the orchestrator.</li>
          <li>The API key generated on first registration is stored locally in a Docker volume — never transmitted again.</li>
          <li>The <code style={{ color: "#e2e8f0" }}>NODE_REGISTRATION_SECRET</code> authenticates the registration handshake only; rotate it via Railway env vars if compromised.</li>
          <li>Mount your local patient data directory as a read-only volume: <code style={{ color: "#e2e8f0" }}>/path/to/data:/data:ro</code></li>
          <li>The container runs with <code style={{ color: "#e2e8f0" }}>no-new-privileges</code> security option enabled.</li>
        </ul>
      </>)}

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#64748b" }}>
        <strong style={{ color: "#94a3b8" }}>Need help?</strong> Email{" "}
        <span style={{ color: "#818cf8" }}>contact@undosatech.com</span> or{" "}
        <span style={{ color: "#818cf8" }}>support@undosatech.com</span>. Include your institution domain and node ID in the subject line.
      </div>
    </div>
  );
}

// ── Main NodeRegistry ─────────────────────────────────────────────────────────
export default function NodeRegistry({ session, selectedNodes, onSelectionChange, onLaunchWithNodes, isAdmin }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [detailNodeId, setDetailNodeId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [view, setView] = useState("nodes"); // "nodes" | "guide"

  const fetchNodes = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${API}/nodes/list`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNodes(await res.json());
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchNodes();
    const id = setInterval(fetchNodes, 15_000);
    return () => clearInterval(id);
  }, [fetchNodes]);

  const toggleNode = (nodeId) => {
    const updated = selectedNodes.includes(nodeId)
      ? selectedNodes.filter(id => id !== nodeId)
      : [...selectedNodes, nodeId];
    onSelectionChange(updated);
  };

  const filtered = nodes.filter(n => {
    if (filter === "online" && n.connectivity !== "online") return false;
    if (filter === "pending" && n.status !== "pending") return false;
    if (search) {
      const q = search.toLowerCase();
      return n.institution_name.toLowerCase().includes(q) || n.node_id.toLowerCase().includes(q) || n.tags?.some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  const onlineCount = nodes.filter(n => n.connectivity === "online").length;
  const pendingCount = nodes.filter(n => n.status === "pending").length;

  const tabBtn = (v, label) => (
    <button onClick={() => setView(v)} style={{ padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: view === v ? 600 : 400, cursor: "pointer", border: "none", background: view === v ? "#22d3a5" : "rgba(255,255,255,0.06)", color: view === v ? "#0f172a" : "#94a3b8" }}>
      {label}
    </button>
  );

  return (
    <div style={{ padding: "0 0 60px" }}>
      <style>{`
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, animation: "fade-in 0.4s ease", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>Node Registry</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            {nodes.length} registered · {onlineCount} online
            {lastRefresh && ` · Updated ${lastRefresh.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabBtn("nodes", "⬡ Nodes")}
          {tabBtn("guide", "📖 Setup Guide")}
          <button onClick={fetchNodes} style={{ ...btn("rgba(255,255,255,0.06)", "#94a3b8"), fontSize: 12 }}>↻ Refresh</button>
          <button onClick={() => setShowRegister(true)} style={{ ...btn("#22d3a5"), fontSize: 13 }}>+ Register Node</button>
        </div>
      </div>

      {view === "guide" && <SetupGuide />}

      {view === "nodes" && <>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20, animation: "fade-in 0.5s ease 0.05s both" }}>
          {[
            { label: "Total Nodes",      value: nodes.length,        color: "#e2e8f0" },
            { label: "Online",           value: onlineCount,          color: "#22d3a5" },
            { label: "Pending Approval", value: pendingCount,         color: "#a78bfa" },
            { label: "Selected",         value: selectedNodes.length, color: "#38bdf8" },
          ].map(s => (
            <div key={s.label} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 16px", backdropFilter: "blur(8px)" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Launch CTA */}
        {selectedNodes.length > 0 && (
          <div style={{ background: "rgba(34,211,165,0.07)", border: "1px solid rgba(34,211,165,0.25)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", animation: "fade-in 0.3s ease", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#22d3a5" }}>✓ {selectedNodes.length} node{selectedNodes.length > 1 ? "s" : ""} selected for your study</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onSelectionChange([])} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}>Clear</button>
              <button onClick={onLaunchWithNodes} style={{ ...btn("#22d3a5"), padding: "7px 16px", fontSize: 13 }}>
                🚀 Launch study with these nodes →
              </button>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", animation: "fade-in 0.5s ease 0.1s both", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search by name, ID, or tag…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          />
          {["all", "online", "pending"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: filter === f ? "1px solid rgba(34,211,165,0.4)" : "1px solid rgba(255,255,255,0.08)", background: filter === f ? "rgba(34,211,165,0.1)" : "rgba(255,255,255,0.03)", color: filter === f ? "#22d3a5" : "#64748b", textTransform: "capitalize" }}>{f}</button>
          ))}
        </div>

        {/* Node grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
            <div style={{ fontSize: 28, marginBottom: 12, animation: "pulse-dot 1.5s ease-in-out infinite" }}>⬡</div>
            Loading nodes…
          </div>
        ) : error ? (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "20px", textAlign: "center", color: "#fca5a5", fontSize: 13 }}>
            Failed to load nodes: {error}
            <br />
            <button onClick={fetchNodes} style={{ ...btn("rgba(239,68,68,0.15)", "#fca5a5"), marginTop: 12, fontSize: 12 }}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
            {search ? `No nodes matching "${search}"` : nodes.length === 0 ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>No nodes registered yet</div>
                <div style={{ fontSize: 13, marginBottom: 16 }}>Institutions run a Docker container on-premise to join your research network.</div>
                <button onClick={() => setView("guide")} style={{ ...btn("rgba(34,211,165,0.12)", "#22d3a5") }}>View Setup Guide →</button>
              </>
            ) : "No nodes match this filter"}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, animation: "fade-in 0.5s ease 0.15s both" }}>
            {filtered.map(node => (
              <NodeCard
                key={node.node_id}
                node={node}
                selected={selectedNodes.includes(node.node_id)}
                onToggle={toggleNode}
                onDetail={n => setDetailNodeId(n.node_id)}
              />
            ))}
          </div>
        )}

        {/* Pending notice */}
        {pendingCount > 0 && (
          <div style={{ marginTop: 20, background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#a78bfa" }}>
            ⏳ {pendingCount} node{pendingCount > 1 ? "s are" : " is"} awaiting approval. Click a pending node to approve it.
            NHS (.nhs.uk) and academic (.ac.uk, .edu) domains are auto-approved on registration.
          </div>
        )}
      </>}

      {/* Modals */}
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onSuccess={fetchNodes} />}
      {detailNodeId && (
        <NodeDetailModal
          nodeId={detailNodeId}
          session={session}
          isAdmin={isAdmin}
          onClose={() => setDetailNodeId(null)}
          onApprove={fetchNodes}
          onSuspend={fetchNodes}
        />
      )}
    </div>
  );
}
