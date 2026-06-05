// portal/src/components/MyStudies.jsx
// ============================================================
// My Studies tab — lists all of the authenticated user's studies
// from Supabase-backed storage. Replaces the previous in-memory
// version. Supports drill-down into live training logs + round chart.
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";

const ORCHESTRATOR = "https://undosatech-production.up.railway.app";

const STATUS_CONFIG = {
  queued:    { color: "#94a3b8", bg: "rgba(148,163,184,0.1)", icon: "⏳", label: "Queued" },
  running:   { color: "#38bdf8", bg: "rgba(56,189,248,0.1)",  icon: "⚡", label: "Running" },
  completed: { color: "#22d3a5", bg: "rgba(34,211,165,0.1)",  icon: "✓",  label: "Complete" },
  failed:    { color: "#ef4444", bg: "rgba(239,68,68,0.1)",   icon: "✗",  label: "Failed" },
  stopped:   { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: "■",  label: "Stopped" },
};

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 99,
      background: c.bg, color: c.color,
      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
    }}>
      <span style={{
        animation: status === "running" ? "spin 1.5s linear infinite" : "none",
        display: "inline-block",
      }}>{c.icon}</span>
      {c.label.toUpperCase()}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ pct, status }) {
  const color = status === "completed" ? "#22d3a5"
              : status === "failed"    ? "#ef4444"
              : status === "stopped"   ? "#f59e0b"
              : "#38bdf8";
  return (
    <div style={{
      height: 4, borderRadius: 99,
      background: "rgba(255,255,255,0.06)", overflow: "hidden",
    }}>
      <div style={{
        height: "100%", width: `${pct || 0}%`,
        background: color, borderRadius: 99,
        transition: "width 0.6s ease",
        boxShadow: status === "running" ? `0 0 8px ${color}` : "none",
      }} />
    </div>
  );
}

// ── Mini round chart (SVG sparkline) ─────────────────────────────────────────
function RoundChart({ rounds }) {
  if (!rounds || rounds.length < 2) return null;

  const W = 200, H = 48, PAD = 4;
  const vals = rounds.map(r => r.accuracy || 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 0.01;

  const points = vals.map((v, i) => {
    const x = PAD + (i / (vals.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <polyline
        points={points}
        fill="none"
        stroke="#22d3a5"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Last point dot */}
      {vals.length > 0 && (() => {
        const last = vals.length - 1;
        const x = PAD + (last / (vals.length - 1)) * (W - PAD * 2);
        const y = PAD + (1 - (vals[last] - min) / range) * (H - PAD * 2);
        return <circle cx={x} cy={y} r={3} fill="#22d3a5" />;
      })()}
    </svg>
  );
}

// ── Live log viewer ───────────────────────────────────────────────────────────
function LiveLogs({ studyId, session, isRunning }) {
  const [logs, setLogs] = useState([]);
  const [lastId, setLastId] = useState(null);
  const bottomRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      const url = new URL(`${ORCHESTRATOR}/studies/${studyId}/logs`);
      if (lastId !== null) url.searchParams.set("since_id", lastId);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data.logs.length > 0) {
        setLogs(prev => [...prev, ...data.logs]);
        setLastId(data.last_id);
      }
    } catch (e) { /* swallow */ }
  }, [studyId, session, lastId]);

  // Initial load + polling while running
  useEffect(() => {
    fetchLogs();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [isRunning, fetchLogs]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const levelColor = { info: "#94a3b8", warning: "#f59e0b", error: "#ef4444" };

  return (
    <div style={{
      background: "rgba(0,0,0,0.3)", borderRadius: 8,
      padding: "12px", maxHeight: 240, overflowY: "auto",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 11, lineHeight: 1.6,
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      {logs.length === 0 ? (
        <span style={{ color: "#475569" }}>Waiting for logs…</span>
      ) : (
        logs.map(l => (
          <div key={l.id} style={{ color: levelColor[l.level] || "#94a3b8" }}>
            <span style={{ color: "#475569", userSelect: "none" }}>
              [{new Date(l.timestamp).toLocaleTimeString()}]
            </span>{" "}
            {l.message}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Study card ────────────────────────────────────────────────────────────────
function StudyCard({ study, session, onStop, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [fullStudy, setFullStudy] = useState(null);
  const [stopping, setStopping] = useState(false);

  const isRunning = study.status === "running";
  const isActive = study.status === "queued" || isRunning;

  // Fetch full details (with rounds) when expanded
  useEffect(() => {
    if (!expanded) return;
    const fetchFull = async () => {
      try {
        const res = await fetch(`${ORCHESTRATOR}/studies/${study.id}/status`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) setFullStudy(await res.json());
      } catch (e) { /* swallow */ }
    };
    fetchFull();
    if (isRunning) {
      const interval = setInterval(fetchFull, 3000);
      return () => clearInterval(interval);
    }
  }, [expanded, isRunning, study.id, session]);

  const handleStop = async (e) => {
    e.stopPropagation();
    setStopping(true);
    await onStop(study.id);
    setStopping(false);
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete study "${study.name}"? This cannot be undone.`)) return;
    await onDelete(study.id);
  };

  const duration = study.completed_at && study.started_at
    ? Math.round((new Date(study.completed_at) - new Date(study.started_at)) / 1000)
    : null;

  return (
    <div style={{
      background: "rgba(15,23,42,0.85)",
      border: expanded ? "1px solid rgba(34,211,165,0.2)" : "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12, overflow: "hidden",
      transition: "border-color 0.2s",
      backdropFilter: "blur(8px)",
    }}>
      {/* Card header — always visible */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{ padding: "16px 18px", cursor: "pointer" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <StatusBadge status={study.status} />
              {study.dp_enabled && (
                <span style={{
                  fontSize: 10, padding: "2px 7px", borderRadius: 99,
                  background: "rgba(167,139,250,0.12)", color: "#a78bfa", fontWeight: 600,
                }}>🔒 DP</span>
              )}
            </div>
            <h3 style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3 }}>
              {study.name}
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
              {study.model} · {study.dataset}
              {duration && ` · ${duration < 60 ? `${duration}s` : `${Math.round(duration/60)}m`}`}
            </p>
          </div>

          <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
            {isActive && (
              <button
                onClick={handleStop}
                disabled={stopping}
                style={{
                  padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.08)", color: "#ef4444",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                {stopping ? "…" : "Stop"}
              </button>
            )}
            {!isActive && (
              <button
                onClick={handleDelete}
                style={{
                  padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)",
                  background: "transparent", color: "#475569",
                  fontSize: 11, cursor: "pointer",
                }}
              >
                🗑
              </button>
            )}
            <span style={{ color: "#475569", fontSize: 14, lineHeight: "28px" }}>
              {expanded ? "▲" : "▼"}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 4 }}>
          <ProgressBar pct={study.progress_pct} status={study.status} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569" }}>
          <span>Round {study.current_round}/{study.total_rounds}</span>
          <span>
            {study.final_accuracy != null
              ? `Accuracy: ${(study.final_accuracy * 100).toFixed(1)}%`
              : `${(study.progress_pct || 0).toFixed(0)}%`}
          </span>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "14px 18px",
          animation: "slide-down 0.2s ease",
        }}>
          {/* Nodes */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Participating Nodes
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {study.nodes?.map(n => (
                <span key={n} style={{
                  fontSize: 11, padding: "3px 10px", borderRadius: 99,
                  background: "rgba(56,189,248,0.08)", color: "#7dd3fc",
                  border: "1px solid rgba(56,189,248,0.15)",
                }}>{n}</span>
              ))}
            </div>
          </div>

          {/* Accuracy chart + per-class */}
          {fullStudy && (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, marginBottom: 14, alignItems: "start" }}>
              <div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Accuracy</div>
                <RoundChart rounds={fullStudy.rounds} />
              </div>
              {fullStudy.per_class_accuracy && Object.keys(fullStudy.per_class_accuracy).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Per-class</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {Object.entries(fullStudy.per_class_accuracy).map(([cls, acc]) => (
                      <span key={cls} style={{
                        fontSize: 10, padding: "2px 7px", borderRadius: 99,
                        background: acc > 0.8 ? "rgba(34,211,165,0.12)" : "rgba(245,158,11,0.12)",
                        color: acc > 0.8 ? "#22d3a5" : "#f59e0b",
                      }}>
                        {cls}: {(acc * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live logs */}
          <div style={{ marginBottom: fullStudy?.status === "completed" ? 14 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Training Log {isRunning && <span style={{ color: "#38bdf8" }}>● LIVE</span>}
            </div>
            <LiveLogs studyId={study.id} session={session} isRunning={isRunning} />
          </div>

          {/* Download model */}
          {fullStudy?.status === "completed" && fullStudy?.model_download_path && (
            <a
              href={`${ORCHESTRATOR}/studies/${study.id}/download`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8, marginTop: 10,
                background: "rgba(34,211,165,0.1)", border: "1px solid rgba(34,211,165,0.25)",
                color: "#22d3a5", fontSize: 12, fontWeight: 600, textDecoration: "none",
              }}
            >
              ↓ Download Model (.pth)
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main MyStudies component ──────────────────────────────────────────────────
export default function MyStudies({ session }) {
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  const fetchStudies = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${ORCHESTRATOR}/studies`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStudies(data.studies);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchStudies();
    // Refresh list every 5s (catches status transitions)
    const interval = setInterval(fetchStudies, 5000);
    return () => clearInterval(interval);
  }, [fetchStudies]);

  const handleStop = async (studyId) => {
    await fetch(`${ORCHESTRATOR}/studies/${studyId}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    fetchStudies();
  };

  const handleDelete = async (studyId) => {
    await fetch(`${ORCHESTRATOR}/studies/${studyId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setStudies(prev => prev.filter(s => s.id !== studyId));
  };

  const filtered = filter === "all" ? studies : studies.filter(s => s.status === filter);

  const counts = studies.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ padding: "0 0 40px" }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes slide-down { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>
            My Studies
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            {studies.length} total · persisted across deploys
          </p>
        </div>
        <button onClick={fetchStudies} style={{
          padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)", color: "#94a3b8",
          fontSize: 12, cursor: "pointer",
        }}>
          ↻ Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {["all", "running", "completed", "failed", "stopped", "queued"].map(f => {
          const count = f === "all" ? studies.length : (counts[f] || 0);
          if (f !== "all" && count === 0) return null;
          const c = STATUS_CONFIG[f] || { color: "#94a3b8" };
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "6px 14px", borderRadius: 99, fontSize: 12, cursor: "pointer",
              border: filter === f ? `1px solid ${c.color}40` : "1px solid rgba(255,255,255,0.07)",
              background: filter === f ? `${c.color}15` : "rgba(255,255,255,0.02)",
              color: filter === f ? c.color : "#64748b",
              fontWeight: filter === f ? 600 : 400,
            }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {count > 0 && <span style={{ marginLeft: 5, opacity: 0.7 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
          Loading studies…
        </div>
      ) : error ? (
        <div style={{
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 10, padding: 20, textAlign: "center", color: "#fca5a5", fontSize: 13,
        }}>
          {error}
          <br />
          <button onClick={fetchStudies} style={{ marginTop: 12, padding: "7px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: 12 }}>
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔬</div>
          {filter === "all" ? "No studies yet — launch one from the Launch Study tab" : `No ${filter} studies`}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, animation: "fade-in 0.4s ease" }}>
          {filtered.map(study => (
            <StudyCard
              key={study.id}
              study={study}
              session={session}
              onStop={handleStop}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
