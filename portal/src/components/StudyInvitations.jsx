// portal/src/components/StudyInvitations.jsx
import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "https://undosatech-production.up.railway.app";

const S = {
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "18px 20px", marginBottom: 12 },
};

const STATUS_STYLE = {
  pending:   { bg: "#fffbeb", color: "#92400e", border: "#fde68a", label: "Pending" },
  accepted:  { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0", label: "Accepted" },
  declined:  { bg: "#fef2f2", color: "#991b1b", border: "#fecaca", label: "Declined" },
  withdrawn: { bg: "#f9fafb", color: "#6b7280", border: "#e5e7eb", label: "Withdrawn" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

// ── Invite modal ──────────────────────────────────────────────────────────────
function InviteModal({ studyId, session, existingNodeIds, onClose, onInvited }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch(`${API}/nodes/list`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
      .then(r => r.json())
      .then(d => setNodes(Array.isArray(d) ? d.filter(n => !existingNodeIds.includes(n.node_id)) : []))
      .catch(() => setNodes([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async () => {
    if (!selected.length) { setErr("Select at least one node."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/studies/${studyId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ node_ids: selected, message }),
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
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Invite nodes</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
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
            <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 16 }}>
              {nodes.map(n => (
                <div key={n.node_id}
                     onClick={() => toggle(n.node_id)}
                     style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: selected.includes(n.node_id) ? "#eff6ff" : "#fff", transition: "background 0.1s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: selected.includes(n.node_id) ? "2px solid #1d4ed8" : "2px solid #d1d5db", background: selected.includes(n.node_id) ? "#1d4ed8" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {selected.includes(n.node_id) && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{n.institution_name}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{n.institution_domain} · {n.node_id}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: n.status === "active" ? "#ecfdf5" : "#f9fafb", color: n.status === "active" ? "#065f46" : "#9ca3af", border: `1px solid ${n.status === "active" ? "#a7f3d0" : "#e5e7eb"}`, fontWeight: 600 }}>
                    {n.status}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>Message to node operators (optional)</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="e.g. We're studying retinal imaging and would like your anonymised OCT scans…"
                rows={3}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
          </>
        )}

        {err && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", color: "#991b1b", fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={busy || !nodes.length} style={{ flex: 2, padding: "9px 0", borderRadius: 8, border: "none", background: "#1d4ed8", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13, opacity: busy || !nodes.length ? 0.6 : 1 }}>
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

  const pending = invitations.filter(i => i.status === "pending").length;

  if (loading) return <div style={{ ...S.card, color: "#9ca3af", fontSize: 13 }}>Loading invitations…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
          Node invitations
          {pending > 0 && <span style={{ marginLeft: 8, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", padding: "1px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{pending} pending</span>}
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: "6px 14px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          + Invite node
        </button>
      </div>

      {actionErr && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", color: "#991b1b", fontSize: 13, marginBottom: 12 }}>{actionErr}</div>
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
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🏥</div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{node.institution_name || inv.node_id}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>
                  {node.institution_domain || inv.node_id}
                  {respondedAt && ` · responded ${respondedAt}`}
                </div>
                {inv.message && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontStyle: "italic" }}>"{inv.message}"</div>}
                {inv.decline_reason && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>Reason: {inv.decline_reason}</div>}
              </div>
              <StatusBadge status={inv.status} />
              {isAdmin && inv.status === "pending" && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => doAction(inv.id, "accept")}
                    disabled={busy === inv.id}
                    style={{ padding: "5px 12px", background: "#059669", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: busy === inv.id ? 0.6 : 1 }}>
                    {busy === inv.id ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => doAction(inv.id, "decline")}
                    disabled={busy === inv.id}
                    style={{ padding: "5px 12px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: busy === inv.id ? 0.6 : 1 }}>
                    Decline
                  </button>
                </div>
              )}
              {inv.status === "pending" && (
                <button
                  onClick={() => { if (confirm("Withdraw this invitation?")) doAction(inv.id, "withdraw"); }}
                  disabled={busy === inv.id}
                  style={{ padding: "5px 10px", background: "none", color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 7, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>
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
    </div>
  );
}
