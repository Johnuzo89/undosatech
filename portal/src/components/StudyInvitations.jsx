// portal/src/components/StudyInvitations.jsx
import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "https://undosatech-production.up.railway.app";

const S = {
  card: { background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 16, padding: "18px 20px", marginBottom: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" },
};

const STATUS_STYLE = {
  pending:   { bg: "rgba(255,159,10,0.1)",   color: "#FF9F0A",  border: "rgba(255,159,10,0.25)",  label: "Pending" },
  accepted:  { bg: "rgba(50,215,75,0.1)",    color: "#1a9e3a",  border: "rgba(50,215,75,0.25)",   label: "Accepted" },
  declined:  { bg: "rgba(255,59,48,0.1)",    color: "#FF3B30",  border: "rgba(255,59,48,0.25)",   label: "Declined" },
  withdrawn: { bg: "rgba(142,142,147,0.1)",  color: "#8E8E93",  border: "rgba(142,142,147,0.25)", label: "Withdrawn" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, letterSpacing: "0.01em" }}>
      {s.label}
    </span>
  );
}

// ── Governance package (shown to the institution before it accepts) ───────────
const ETHICS_LABEL = { approved: "✓ Ethics approved", pending: "⏳ Ethics review pending", exempt: "Exempt from ethics review" };

export function GovernancePackage({ gov, dark = false }) {
  if (!gov) return (
    <div style={{ fontSize: 12, color: dark ? "#8E8E93" : "#9ca3af", fontStyle: "italic" }}>
      No governance package on this invitation (sent before governance packages were required).
    </div>
  );
  const fg = dark ? "#e2e8f0" : "#1D1D1F";
  const muted = dark ? "#8E8E93" : "#6b7280";
  const priv = gov.privacy_settings || {};
  const rows = [
    ["Research question", gov.research_question],
    ["Investigator", gov.investigator],
    ["Ethics status", `${ETHICS_LABEL[gov.ethics_status] || gov.ethics_status}${gov.ethics_reference ? ` · ${gov.ethics_reference}` : ""}`],
    ["Requested dataset", gov.dataset],
    ["Requested variables", gov.requested_variables],
    ["Model version", gov.model_version],
    ["Privacy settings", priv.dp_enabled
      ? `Differential privacy on (ε = ${priv.dp_epsilon ?? "—"}) · small-cell suppression <${priv.sdc_min_cell_count ?? 5}`
      : `No DP on this study · small-cell suppression <${priv.sdc_min_cell_count ?? 5}`],
    ["Expected outputs", gov.expected_outputs],
    ["Retention", gov.retention],
    ["Withdrawal", gov.withdrawal],
  ].filter(([, v]) => v);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <div style={{ fontSize: 10, fontWeight: 700, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
          <div style={{ fontSize: 12.5, color: fg, lineHeight: 1.5 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Invite modal ──────────────────────────────────────────────────────────────
function InviteModal({ studyId, session, existingNodeIds, onClose, onInvited }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState("");
  const [gov, setGov] = useState({
    research_question: "", ethics_status: "approved", ethics_reference: "",
    requested_variables: "", expected_outputs: "", retention: "", withdrawal: "",
  });
  const setG = (k, v) => setGov(g => ({ ...g, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch(`${API}/nodes/list`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
      .then(r => r.json())
      .then(d => setNodes(Array.isArray(d) ? d.filter(n => !existingNodeIds.includes(n.node_id)) : []))
      .catch(() => setNodes([]))
      .finally(() => setLoading(false));
    // Mount-only fetch: the modal remounts on open, and existingNodeIds is a
    // fresh array each parent render — depending on it would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async () => {
    if (!selected.length) { setErr("Select at least one node."); return; }
    if (!gov.research_question.trim()) { setErr("State the research question — the institution sees it before accepting."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/studies/${studyId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ node_ids: selected, message, governance: gov }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || "Invite failed"); }
      onInvited();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 32px 64px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>Invite nodes</h3>
          <button onClick={onClose} style={{ background: "rgba(0,0,0,0.05)", border: "none", fontSize: 18, cursor: "pointer", color: "#8E8E93", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: 30, color: "#9ca3af" }}>Loading nodes…</div>}

        {!loading && nodes.length === 0 && (
          <div style={{ textAlign: "center", padding: 24, color: "#9ca3af", fontSize: 13 }}>
            No available nodes to invite. All registered nodes are already invited, or none are registered yet.
          </div>
        )}

        {!loading && nodes.length > 0 && (
          <>
            <div style={{ marginBottom: 14, fontSize: 12, color: "#6b7280" }}>
              Select registered nodes to invite to this study.
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>
              {nodes.map(n => (
                <div key={n.node_id}
                     onClick={() => toggle(n.node_id)}
                     style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.05)", cursor: "pointer", background: selected.includes(n.node_id) ? "rgba(0,122,255,0.04)" : "#fff", transition: "background 0.1s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: selected.includes(n.node_id) ? "2px solid #007AFF" : "2px solid rgba(0,0,0,0.15)", background: selected.includes(n.node_id) ? "#007AFF" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {selected.includes(n.node_id) && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#1D1D1F" }}>{n.institution_name}</div>
                    <div style={{ fontSize: 11, color: "#8E8E93" }}>{n.institution_domain} · {n.node_id}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 99, background: n.status === "active" ? "rgba(50,215,75,0.1)" : "rgba(142,142,147,0.1)", color: n.status === "active" ? "#1a9e3a" : "#8E8E93", border: `1px solid ${n.status === "active" ? "rgba(50,215,75,0.25)" : "rgba(142,142,147,0.25)"}`, fontWeight: 600 }}>
                    {n.status}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ background: "rgba(0,122,255,0.05)", border: "1px solid rgba(0,122,255,0.18)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#007AFF", marginBottom: 2 }}>Governance package</div>
              <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.5, marginBottom: 12 }}>
                The institution sees this before deciding. Dataset, model version, and privacy settings are
                attached automatically from the study; retention and withdrawal use platform defaults unless you override them.
              </div>
              {[
                ["Research question *", "research_question", "e.g. Can archived OCT predict progression from intermediate to advanced AMD within 2 years?"],
                ["Requested variables", "requested_variables", "e.g. OCT volumes, AMD stage labels, age band — no identifiers"],
                ["Expected outputs", "expected_outputs", "e.g. Aggregate model + per-class metrics; no patient-level outputs"],
              ].map(([lbl, key, ph]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>{lbl}</label>
                  <textarea value={gov[key]} onChange={e => setG(key, e.target.value)} placeholder={ph} rows={2}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", fontSize: 12.5, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", background: "#fff", color: "#1D1D1F", outline: "none" }} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Ethics status *</label>
                  <select value={gov.ethics_status} onChange={e => setG("ethics_status", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", fontSize: 12.5, background: "#fff", color: "#1D1D1F" }}>
                    <option value="approved">Approved</option>
                    <option value="pending">Review pending</option>
                    <option value="exempt">Exempt</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Ethics reference</label>
                  <input value={gov.ethics_reference} onChange={e => setG("ethics_reference", e.target.value)} placeholder="REC-24/SC/0123"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", fontSize: 12.5, boxSizing: "border-box", background: "#fff", color: "#1D1D1F", outline: "none" }} />
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>Message to node operators (optional)</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="e.g. We're studying retinal imaging and would like your anonymised OCT scans…"
                rows={3}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)", fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", background: "rgba(0,0,0,0.04)", color: "#1D1D1F", outline: "none" }}
              />
            </div>
          </>
        )}

        {err && <div style={{ background: "rgba(255,59,48,0.08)", border: "1px solid rgba(255,59,48,0.2)", borderRadius: 10, padding: "9px 14px", color: "#FF3B30", fontSize: 13, marginBottom: 12, fontWeight: 500 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)", background: "#fff", color: "#6E6E73", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={busy || !nodes.length} style={{ flex: 2, padding: "10px 0", borderRadius: 10, border: "none", background: "#007AFF", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13, opacity: busy || !nodes.length ? 0.5 : 1, boxShadow: "0 2px 8px rgba(0,122,255,0.3)" }}>
            {busy ? "Sending…" : `Invite ${selected.length || ""} node${selected.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StudyInvitations({ studyId, session, isAdmin }) {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(null); // inv id being actioned
  const [actionErr, setActionErr] = useState(null);
  const [duaModal, setDuaModal] = useState(null);
  const [duaText, setDuaText] = useState('');
  const [govOpen, setGovOpen] = useState(null); // inv id with expanded governance package

  const fetch_ = useCallback(async () => {
    try {
      const r = await fetch(`${API}/studies/${studyId}/invitations`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      setInvitations(r.ok ? await r.json() : []);
    } catch {
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [studyId, session]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const doAction = async (invId, action, body = {}) => {
    setBusy(invId); setActionErr(null);
    try {
      const r = await fetch(`${API}/invitations/${invId}/${action}`, {
        method: action === "withdraw" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: action !== "withdraw" ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || "Failed"); }
      await fetch_();
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleAcceptClick = async (invId) => {
    try {
      const r = await fetch(`${API}/dua`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      const res = r.ok ? await r.json() : null;
      setDuaText(res?.text || 'By accepting, you agree to the UndosaTech Data Use Agreement. Patient data remains on-premise at all times. Only model updates are transmitted.');
    } catch {
      setDuaText('By accepting, you agree to the UndosaTech Data Use Agreement. Patient data remains on-premise at all times. Only model updates are transmitted.');
    }
    setDuaModal(invId);
  };

  const confirmAccept = async () => {
    const invId = duaModal;
    setDuaModal(null);
    await doAction(invId, "accept", { dua_acknowledged: true });
  };

  const pending = invitations.filter(i => i.status === "pending").length;

  if (loading) return <div style={{ ...S.card, color: "#9ca3af", fontSize: 13 }}>Loading invitations…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1D1D1F", letterSpacing: "-0.01em" }}>
          Node invitations
          {pending > 0 && <span style={{ marginLeft: 8, background: "rgba(255,159,10,0.1)", color: "#FF9F0A", border: "1px solid rgba(255,159,10,0.25)", padding: "2px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{pending} pending</span>}
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: "6px 14px", background: "#007AFF", color: "#fff", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(0,122,255,0.3)" }}>
          + Invite node
        </button>
      </div>

      {actionErr && (
        <div style={{ background: "rgba(255,59,48,0.08)", border: "1px solid rgba(255,59,48,0.2)", borderRadius: 10, padding: "9px 14px", color: "#FF3B30", fontSize: 13, marginBottom: 12, fontWeight: 500 }}>{actionErr}</div>
      )}

      {invitations.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "32px 20px" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📨</div>
          No nodes invited yet. Invite registered nodes to formally record their consent to participate in this study.
        </div>
      ) : (
        invitations.map(inv => {
          const node = inv.fl_nodes || {};
          const respondedAt = inv.responded_at ? new Date(inv.responded_at).toLocaleDateString() : null;
          return (
            <div key={inv.id} style={{ ...S.card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(0,122,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🏥</div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#1D1D1F" }}>{node.institution_name || inv.node_id}</div>
                <div style={{ fontSize: 11, color: "#8E8E93" }}>
                  {node.institution_domain || inv.node_id}
                  {respondedAt && ` · responded ${respondedAt}`}
                </div>
                {inv.message && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontStyle: "italic" }}>"{inv.message}"</div>}
                {inv.decline_reason && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>Reason: {inv.decline_reason}</div>}
                <button onClick={() => setGovOpen(govOpen === inv.id ? null : inv.id)}
                  style={{ marginTop: 6, padding: "3px 10px", borderRadius: 8, border: "1px solid rgba(0,122,255,0.3)", background: "rgba(0,122,255,0.05)", color: "#007AFF", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  📋 Governance package {govOpen === inv.id ? "▴" : "▾"}
                </button>
                {govOpen === inv.id && (
                  <div style={{ marginTop: 10, padding: "12px 14px", background: "#f9fafb", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)" }}>
                    <GovernancePackage gov={inv.governance} />
                  </div>
                )}
              </div>
              <StatusBadge status={inv.status} />
              {isAdmin && inv.status === "pending" && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => handleAcceptClick(inv.id)}
                    disabled={busy === inv.id}
                    style={{ padding: "5px 12px", background: "rgba(50,215,75,0.12)", color: "#1a9e3a", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: busy === inv.id ? 0.6 : 1 }}>
                    {busy === inv.id ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => doAction(inv.id, "decline")}
                    disabled={busy === inv.id}
                    style={{ padding: "5px 12px", background: "rgba(255,59,48,0.08)", color: "#FF3B30", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: busy === inv.id ? 0.6 : 1 }}>
                    Decline
                  </button>
                </div>
              )}
              {inv.status === "pending" && (
                <button
                  onClick={() => { if (confirm("Withdraw this invitation?")) doAction(inv.id, "withdraw"); }}
                  disabled={busy === inv.id}
                  style={{ padding: "5px 10px", background: "none", color: "#8E8E93", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>
                  Withdraw
                </button>
              )}
            </div>
          );
        })
      )}

      {showModal && (
        <InviteModal
          studyId={studyId}
          session={session}
          existingNodeIds={invitations.map(i => i.node_id)}
          onClose={() => setShowModal(false)}
          onInvited={fetch_}
        />
      )}

      {duaModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 560, width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Before you accept</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>Review what this study asks of your institution, then acknowledge the Data Use Agreement.</div>
            <div style={{ padding: '12px 14px', background: 'rgba(0,122,255,0.04)', border: '1px solid rgba(0,122,255,0.15)', borderRadius: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#007AFF', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Governance package</div>
              <GovernancePackage gov={invitations.find(i => i.id === duaModal)?.governance} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Data Use Agreement</div>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f9fafb', borderRadius: 8, padding: 14, marginBottom: 16, fontFamily: 'monospace' }}>{duaText}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDuaModal(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={confirmAccept} style={{ padding: '8px 16px', borderRadius: 8, background: '#007AFF', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>I Acknowledge & Accept</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
