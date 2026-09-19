"use client";
import { useEffect, useState } from "react";
import { api, type AuditEvent, type AuditVerdict } from "@/lib/api";

/**
 * The audit trail, and a button that re-walks the hash chain in front of you.
 * Refusals are shown, not hidden: when the agent tries to commit something and
 * is stopped, that is a record, not an error.
 */
export function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [verdict, setVerdict] = useState<AuditVerdict | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setEvents((await api.audit(20)).events);
      } catch {
        /* panel is non-critical */
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const verify = async () => {
    setBusy(true);
    try {
      setVerdict(await api.verifyAudit());
    } catch {
      setVerdict({ valid: false, length: 0, brokenAt: null, reason: "could not reach the backend" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Audit trail">
      <header className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Audit trail</h2>
        <button
          onClick={verify}
          disabled={busy}
          className="lc-btn disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify chain"}
        </button>
        {verdict && (
          <span className={`lc-chip ${verdict.valid ? "lc-chip-ok" : "lc-chip-danger"}`}>
            {verdict.valid
              ? `Intact — ${verdict.length} records`
              : `Broken at #${verdict.brokenAt}: ${verdict.reason}`}
          </span>
        )}
      </header>

      {events.length === 0 && <p className="text-sm lc-subtle">No recorded actions yet.</p>}

      <ol className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1">
        {events.map((e) => (
          <li
            key={e.hash ?? `legacy-${e.seq}`}
            className="flex flex-wrap items-baseline gap-3 rounded-lg border px-3 py-2 text-sm"
            style={
              e.outcome === "denied"
                ? { borderColor: "var(--warn)", background: "var(--warn-bg)" }
                : { borderColor: "var(--border)", background: "var(--surface)" }
            }
          >
            <span className="font-mono lc-subtle">#{e.seq}</span>
            <span className="font-medium">{e.action}</span>
            {e.outcome === "denied" && (
              <span className="lc-chip lc-chip-warn">
                refused
              </span>
            )}
            <span className="lc-muted">{e.entityId}</span>
            {e.actor?.roles?.includes("operator-agent") && (
              <span className="lc-chip lc-chip-neutral">agent</span>
            )}
            {typeof e.payload?.reason === "string" && (
              <span className="lc-subtle">{e.payload.reason}</span>
            )}
            <span className="ml-auto flex items-center gap-2 font-mono text-xs lc-subtle">
              {e.at && <span>{new Date(e.at).toISOString().slice(11, 19)}</span>}
              {/* Rows written before the hash chain existed carry actorId
                  instead of actor.sub and have no hash at all. Render them
                  rather than crashing the panel. */}
              <span>{e.actor?.sub ?? e.actorId ?? "system"}</span>
              {e.hash ? (
                <span title={e.hash}>{e.hash.slice(0, 8)}</span>
              ) : (
                <span className="lc-subtle">pre-chain</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
