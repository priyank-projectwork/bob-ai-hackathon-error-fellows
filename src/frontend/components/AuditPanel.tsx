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
          className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600 disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify chain"}
        </button>
        {verdict && (
          <span className={`rounded px-2 py-1 text-sm ${verdict.valid ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
            {verdict.valid
              ? `Intact — ${verdict.length} records`
              : `Broken at #${verdict.brokenAt}: ${verdict.reason}`}
          </span>
        )}
      </header>

      {events.length === 0 && <p className="text-sm opacity-60">No recorded actions yet.</p>}

      <ol className="flex flex-col gap-1">
        {events.map((e) => (
          <li
            key={e.hash}
            className={`flex flex-wrap items-baseline gap-3 rounded border px-3 py-2 text-sm ${
              e.outcome === "denied"
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-slate-700/40 bg-slate-900/30"
            }`}
          >
            <span className="font-mono opacity-50">#{e.seq}</span>
            <span className="font-medium">{e.action}</span>
            {e.outcome === "denied" && (
              <span className="rounded bg-amber-500/25 px-2 py-0.5 text-xs font-medium text-amber-200">
                refused
              </span>
            )}
            <span className="opacity-70">{e.entityId}</span>
            <span className="ml-auto flex items-center gap-2 font-mono text-xs opacity-60">
              <span>{e.actor.sub}</span>
              <span title={e.hash}>{e.hash.slice(0, 8)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
