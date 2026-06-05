// portal/src/components/NodeRegistry.jsx
// ============================================================
// Node Registry tab — shows all registered FL nodes,
// their live status, and lets researchers register new ones.
// ============================================================

import { useState, useEffect, useCallback } from "react";

const ORCHESTRATOR = "https://undosatech-production.up.railway.app";

// ── Connectivity badge ────────────────────────────────────────────────────────
function ConnectivityBadge({ connectivity, status }) {
  const map = {
    online:      { dot: "#22d3a5", label: "Online",      bg: "rgba(34,211,165,0.12)",  text: "#22d3a5" },
    degraded:    { dot: "#f59e0b", label: "Degraded",    bg: "rgba(245,158,11,0.12)",  text: "#f59e0b" },
    unreachable: { dot: "#ef4444", label: "Unreachable", bg: "rgba(239,68,68,0.12)",   text: "#ef4444" },
    pending:     { dot: "#a78bfa", label: "Pending",     bg: "rgba(167,139,250,0.12)", text: "#a78bfa" },
    suspended:   { dot: "#6b7280", label: "Suspended",   bg: "rgba(107,114,128,0.12)", text: "#6b7280" },
  };

  const key = status === "pending" ? "pending"
             : status === "suspended" ? "suspended"
             : connectivity;
  const c = map[key] || map.unreachable;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "2px 9px", borderRadius: "99px",
      background: c.bg, color: c.text, fontSize: "11px", fontWeight: 600,
      letterSpacing: "0.04em", textTransform: "uppercase",
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", background: c.dot,
        boxShadow: key === "online" ? `0 0 6px ${c.dot}` : "none",
        animation: key === "online" ? "pulse-dot 2s ease-in-out infinite" : "none",
      }} />
      {c.label}
    </span>
  );
}

// ── Node card ─────────────────────────────────────────────────────────────────
function NodeCard({ node, selected, onToggle }) {
  const selectable = node.status === "active";
  const lastSeen = node.last_heartbeat
    ? new Date(node.last_heartbeat).toLocaleString()
    : "Never";

  return (
    <div
      onClick={() => selectable && onToggle(node.node_id)}
      style={{
        background: selected
          ? "linear-gradient(135deg, rgba(34,211,165,0.07) 0%, rgba(15,23,42,0.95) 100%)"
          : "rgba(15,23,42,0.85)",
        border: selected ? "1px solid rgba(34,211,165,0.4)" : "1px solid rgba(255,255,255,0.07)",
        borderRadius: "12px",
        padding: "18px 20px",
        cursor: selectable ? "pointer" : "default",
        opacity: selectable ? 1 : 0.65,
        transition: "all 0.2s ease",
        position: "relative",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Selection checkbox */}
      {selectable && (
        <div style={{
          position: "absolute", top: 16, right: 16,
          width: 18, height: 18, borderRadius: "5px",
          border: selected ? "2px solid #22d3a5" : "2px solid rgba(255,255,255,0.2)",
          background: selected ? "#22d3a5" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}>
          {selected && <span style={{ color: "#0f172a", fontSize: 11, fontWeight: 700 }}>✓</span>}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <ConnectivityBadge connectivity={node.connectivity} status={node.status} />
          {node.gpu_available && (
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: "0.05em",
              background: "rgba(168,85,247,0.15)", color: "#c084fc",
              padding: "2px 7px", borderRadius: "99px", textTransform: "uppercase",
            }}>GPU</span>
          )}
        </div>
        <h3 style={{
          margin: 0, fontSize: 14, fontWeight: 700,
          color: "#e2e8f0", lineHeight: 1.3,
        }}>
          {node.institution_name}
        </h3>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
          {node.institution_domain} · {node.node_id}
        </p>
      </div>

      {/* Tags */}
      {node.tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
          {node.tags.map(t => (
            <span key={t} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: "99px",
              background: "rgba(99,102,241,0.12)", color: "#818cf8",
              fontWeight: 500, textTransform: "capitalize",
            }}>{t}</span>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 8, fontSize: 11, color: "#64748b",
      }}>
        <span>📊 {node.max_samples?.toLocaleString() ?? "—"} max samples</span>
        <span>🕐 {lastSeen}</span>
        <span style={{ gridColumn: "1 / -1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          🧠 {node.supported_models?.slice(0, 3).join(", ")}
          {node.supported_models?.length > 3 && ` +${node.supported_models.length - 3}`}
        </span>
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

  const ALL_MODELS = [
    "ResNet-18", "ResNet-50", "ResNet-101",
    "EfficientNet-B0", "EfficientNet-B4",
    "ViT-B/16", "Lightweight CNN",
  ];

  const toggleModel = (m) => setForm(f => ({
    ...f,
    supported_models: f.supported_models.includes(m)
      ? f.supported_models.filter(x => x !== m)
      : [...f.supported_models, m],
  }));

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const payload = {
        ...form,
        port: parseInt(form.port) || 8080,
        max_samples: form.max_samples ? parseInt(form.max_samples) : null,
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      };

      const res = await fetch(`${ORCHESTRATOR}/nodes/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Registration failed");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(result.api_key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const input = (label, key, type = "text", placeholder = "") => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "9px 12px", borderRadius: 8, boxSizing: "border-box",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
          color: "#e2e8f0", fontSize: 13, outline: "none",
        }}
      />
    </div>
  );

  if (result) {
    return (
      <div style={modalOverlayStyle}>
        <div style={{ ...modalBoxStyle, maxWidth: 520 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <h2 style={{ color: "#22d3a5", margin: "0 0 6px", fontSize: 20 }}>Node Registered!</h2>
            <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>{result.message}</p>
          </div>

          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "14px 16px", marginBottom: 20,
          }}>
            <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#fca5a5" }}>
              ⚠️ SAVE THIS API KEY — it will never be shown again
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{
                flex: 1, fontSize: 11, background: "rgba(0,0,0,0.3)",
                padding: "8px 10px", borderRadius: 6, color: "#fde68a",
                wordBreak: "break-all", display: "block",
              }}>{result.api_key}</code>
              <button onClick={copyKey} style={{
                ...btnStyle("#22d3a5"), flexShrink: 0, padding: "8px 14px", fontSize: 12,
              }}>
                {copiedKey ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>

          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
            Add this key to your <code>.env.node</code> file as your node auto-saves it in <code>KEY_FILE</code>.
          </p>

          <button onClick={() => { onSuccess(); onClose(); }} style={{ ...btnStyle("#22d3a5"), width: "100%" }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalBoxStyle, maxWidth: 580 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, color: "#e2e8f0", fontSize: 18 }}>Register FL Node</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div style={{ gridColumn: "1 / -1" }}>{input("Node ID", "node_id", "text", "nhs-kings-001")}</div>
          <div style={{ gridColumn: "1 / -1" }}>{input("Institution Name", "institution_name", "text", "King's College Hospital NHS Foundation Trust")}</div>
          {input("Domain", "institution_domain", "text", "kch.nhs.uk")}
          {input("Contact Email", "contact_email", "email", "research@kch.nhs.uk")}
          {input("Public Host", "host", "text", "203.0.113.10")}
          {input("Port", "port", "number", "8080")}
          {input("Max Samples", "max_samples", "number", "10000")}
          <div>{input("Tags (comma-sep)", "tags", "text", "ophthalmology, retinal")}</div>
        </div>

        {/* Model selection */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Supported Models
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALL_MODELS.map(m => (
              <button key={m} onClick={() => toggleModel(m)} style={{
                padding: "5px 11px", borderRadius: 99, fontSize: 11, cursor: "pointer",
                border: form.supported_models.includes(m) ? "1px solid #22d3a5" : "1px solid rgba(255,255,255,0.12)",
                background: form.supported_models.includes(m) ? "rgba(34,211,165,0.12)" : "transparent",
                color: form.supported_models.includes(m) ? "#22d3a5" : "#64748b",
                transition: "all 0.15s",
              }}>{m}</button>
            ))}
          </div>
        </div>

        {/* GPU toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button
            onClick={() => setForm(f => ({ ...f, gpu_available: !f.gpu_available }))}
            style={{
              width: 40, height: 22, borderRadius: 99, border: "none",
              background: form.gpu_available ? "#22d3a5" : "rgba(255,255,255,0.1)",
              cursor: "pointer", position: "relative", transition: "background 0.2s",
            }}
          >
            <span style={{
              position: "absolute", top: 3, left: form.gpu_available ? 20 : 3,
              width: 16, height: 16, borderRadius: "50%", background: "#fff",
              transition: "left 0.2s",
            }} />
          </button>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>GPU Available</span>
        </div>

        {input("Registration Secret", "registration_secret", "password", "Provided by UndosaTech team")}

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#fca5a5",
          }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...btnStyle("rgba(255,255,255,0.08)"), flex: 1, color: "#94a3b8" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading} style={{ ...btnStyle("#22d3a5"), flex: 2 }}>
            {loading ? "Registering…" : "Register Node"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main NodeRegistry component ───────────────────────────────────────────────
export default function NodeRegistry({ session, selectedNodes, onSelectionChange }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState("all"); // all | online | pending
  const [search, setSearch] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchNodes = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${ORCHESTRATOR}/nodes/list`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNodes(data);
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
    const interval = setInterval(fetchNodes, 15_000); // refresh every 15s
    return () => clearInterval(interval);
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
      return n.institution_name.toLowerCase().includes(q)
          || n.node_id.toLowerCase().includes(q)
          || n.tags?.some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  const onlineCount = nodes.filter(n => n.connectivity === "online").length;
  const pendingCount = nodes.filter(n => n.status === "pending").length;

  return (
    <div style={{ padding: "0 0 40px" }}>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        marginBottom: 24, animation: "fade-in 0.4s ease",
      }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>
            Node Registry
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            {nodes.length} registered · {onlineCount} online
            {lastRefresh && ` · Updated ${lastRefresh.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={fetchNodes} style={{ ...btnStyle("rgba(255,255,255,0.06)"), color: "#94a3b8", fontSize: 12 }}>
            ↻ Refresh
          </button>
          <button onClick={() => setShowModal(true)} style={{ ...btnStyle("#22d3a5"), fontSize: 13 }}>
            + Register Node
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10,
        marginBottom: 20, animation: "fade-in 0.5s ease 0.05s both",
      }}>
        {[
          { label: "Total Nodes",   value: nodes.length,        color: "#e2e8f0" },
          { label: "Online",        value: onlineCount,          color: "#22d3a5" },
          { label: "Pending Approval", value: pendingCount,      color: "#a78bfa" },
          { label: "Selected",      value: selectedNodes.length, color: "#38bdf8" },
        ].map(s => (
          <div key={s.label} style={{
            background: "rgba(15,23,42,0.7)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: "12px 16px", backdropFilter: "blur(8px)",
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Selection note */}
      {selectedNodes.length > 0 && (
        <div style={{
          background: "rgba(34,211,165,0.07)", border: "1px solid rgba(34,211,165,0.2)",
          borderRadius: 10, padding: "10px 16px", marginBottom: 16,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 13, color: "#22d3a5", animation: "fade-in 0.3s ease",
        }}>
          <span>✓ {selectedNodes.length} node{selectedNodes.length > 1 ? "s" : ""} selected for your study</span>
          <button
            onClick={() => onSelectionChange([])}
            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div style={{
        display: "flex", gap: 10, marginBottom: 16, alignItems: "center",
        animation: "fade-in 0.5s ease 0.1s both",
      }}>
        <input
          type="text"
          placeholder="Search by name, ID, or tag…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: "8px 14px", borderRadius: 8,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#e2e8f0", fontSize: 13, outline: "none",
          }}
        />
        {["all", "online", "pending"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "8px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer",
            border: filter === f ? "1px solid rgba(34,211,165,0.4)" : "1px solid rgba(255,255,255,0.08)",
            background: filter === f ? "rgba(34,211,165,0.1)" : "rgba(255,255,255,0.03)",
            color: filter === f ? "#22d3a5" : "#64748b",
            textTransform: "capitalize",
          }}>{f}</button>
        ))}
      </div>

      {/* Node grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
          <div style={{ fontSize: 28, marginBottom: 12, animation: "pulse-dot 1.5s ease-in-out infinite" }}>⬡</div>
          Loading nodes…
        </div>
      ) : error ? (
        <div style={{
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 10, padding: "20px", textAlign: "center", color: "#fca5a5", fontSize: 13,
        }}>
          Failed to load nodes: {error}
          <br />
          <button onClick={fetchNodes} style={{ ...btnStyle("#ef4444"), marginTop: 12, fontSize: 12 }}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          {search ? `No nodes matching "${search}"` : "No nodes found"}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 12,
          animation: "fade-in 0.5s ease 0.15s both",
        }}>
          {filtered.map(node => (
            <NodeCard
              key={node.node_id}
              node={node}
              selected={selectedNodes.includes(node.node_id)}
              onToggle={toggleNode}
            />
          ))}
        </div>
      )}

      {/* Pending approval notice */}
      {pendingCount > 0 && (
        <div style={{
          marginTop: 20, background: "rgba(167,139,250,0.07)",
          border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10,
          padding: "12px 16px", fontSize: 12, color: "#a78bfa",
        }}>
          ⏳ {pendingCount} node{pendingCount > 1 ? "s are" : " is"} awaiting admin approval.
          Nodes from NHS (.nhs.uk) and academic (.ac.uk) domains are auto-approved.
        </div>
      )}

      {showModal && (
        <RegisterModal
          onClose={() => setShowModal(false)}
          onSuccess={fetchNodes}
        />
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const btnStyle = (bg) => ({
  padding: "9px 18px", borderRadius: 8, border: "none",
  background: bg, color: bg === "#22d3a5" ? "#0f172a" : undefined,
  fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s",
});

const modalOverlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
  backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
  justifyContent: "center", zIndex: 1000, padding: 20,
};

const modalBoxStyle = {
  background: "linear-gradient(145deg, #0f172a, #1e293b)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16, padding: "28px 28px", width: "100%",
  maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
};
