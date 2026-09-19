"use client";
import { useEffect, useState } from "react";
import { api, type LifeClock, type Excursion } from "@/lib/api";
import { LifeClockRing, TwoClocks } from "./LifeClockRing";

/**
 * Everything known about one shipment, in the order a duty officer needs it:
 * how long it has, what is wrong, why, and what the rule says to do about it.
 */
export function ShipmentDetail({
  shipmentId,
  onClose,
  onAction,
}: {
  shipmentId: string;
  onClose: () => void;
  onAction?: () => void;
}) {
  const [clock, setClock] = useState<LifeClock | null>(null);
  const [excursion, setExcursion] = useState<Excursion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<
    { kind: "signed"; hash: string } | { kind: "refused"; message: string; actor: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  /**
   * Sign the disposition — or let Bob try, and be refused.
   *
   * This is the product's whole argument in two buttons: a human commits, an
   * agent cannot. Before this, the only way to see the refusal was to install
   * IBM Bob or send a curl request by hand.
   */
  const sign = async (asBob: boolean) => {
    if (!excursion) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await api.signDisposition(
        excursion._id,
        excursion.recommendedDisposition ?? "quarantine_qa",
        reason || "Reviewed against the rule profile",
        asBob
      );
      setOutcome({ kind: "signed", hash: res.auditHash });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setOutcome({
        kind: "refused",
        message: err.message ?? "refused",
        actor: asBob ? "bob" : "operator",
      });
    } finally {
      setBusy(false);
      onAction?.();
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const lc = await api.lifeClock(shipmentId);
        if (!alive) return;
        setClock(lc);
        setError(null);
        if (lc.openExcursionId) {
          const all = await api.excursions("Open");
          if (!alive) return;
          setExcursion(all.excursions.find((e) => e.shipmentId === shipmentId) ?? null);
        } else {
          setExcursion(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "could not load");
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [shipmentId]);

  if (error) return <div className="lc-card p-4 text-sm">Could not load {shipmentId}: {error}</div>;
  if (!clock) return <div className="lc-card p-4 text-sm lc-subtle">Loading {shipmentId}…</div>;

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-4 border-t py-1.5" style={{ borderColor: "var(--border)" }}>
      <span className="text-xs lc-muted">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );

  return (
    <section className="lc-card flex flex-col gap-3 p-4" aria-label={`Detail for ${shipmentId}`}>
      <header className="flex items-start gap-3">
        <LifeClockRing hours={clock.lifeClockH} state={clock.state} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-base font-semibold">{shipmentId}</h2>
          <p className="text-xs lc-muted">
            {clock.profile.name} v{clock.profile.version} · {clock.profile.rangeC[0]}–{clock.profile.rangeC[1]} °C
          </p>
          {clock.irreversible && (
            <span className="lc-chip lc-chip-danger mt-1">irreversible — cannot be recovered</span>
          )}
        </div>
        <button onClick={onClose} className="lc-btn px-2 py-0.5 text-xs" aria-label="Close detail">
          ✕
        </button>
      </header>

      <TwoClocks
        scheduleH={clock.scheduleMarginH}
        stabilityH={clock.stabilityMarginH}
        binding={clock.bindingConstraint}
      />

      <div>
        <Row label="Current temperature">
          {clock.tempC != null ? `${clock.tempC.toFixed(1)} °C` : "no reading yet"}
        </Row>
        <Row label="Value at risk">
          <span className="font-mono">${Math.round(clock.usdAtRisk).toLocaleString()}</span>
          <span className="lc-subtle"> of {Math.round(clock.usdAtRisk / Math.max(clock.pLoss, 0.0001)).toLocaleString()}</span>
        </Row>
        {clock.dosesAtRisk > 0 && (
          <Row label="Doses at risk">{clock.dosesAtRisk.toLocaleString()}</Row>
        )}
        <Row label="Spoilage probability">{(clock.pLoss * 100).toFixed(1)}%</Row>
      </div>

      {excursion ? (
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--warn)", background: "var(--warn-bg)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="lc-chip lc-chip-warn">{excursion.severity}</span>
            <span className="text-sm font-medium">
              {excursion.bandKey} band · {Math.round(excursion.durationMin ?? 0)} min
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <div>
              Peak <strong>{excursion.peakTempC?.toFixed(1)} °C</strong>
              {excursion.mktC != null && <> · MKT <strong>{excursion.mktC.toFixed(1)} °C</strong></>}
            </div>
            {excursion.rootCause?.code && (
              <div>
                Cause: <strong>{excursion.rootCause.code}</strong>
                <span className="lc-muted"> ({excursion.rootCause.confidence} confidence)</span>
              </div>
            )}
            {excursion.custodyCarrier && <div>In custody of <strong>{excursion.custodyCarrier}</strong></div>}
            {excursion.ruleProfileRef && (
              <div className="lc-subtle">
                Judged under {excursion.ruleProfileRef.profileKey} v{excursion.ruleProfileRef.version}
              </div>
            )}
          </div>
          <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--warn)" }}>
            <div className="text-xs">
              Recommended: <strong>{excursion.recommendedDisposition}</strong>
              <span className="lc-muted"> — must be signed by {excursion.requiredRole}</span>
            </div>

            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for the record (optional)"
              className="mt-2 w-full rounded-lg border px-2.5 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
            />

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => sign(false)}
                disabled={busy}
                className="lc-btn is-active flex-1 py-2 font-semibold disabled:opacity-50"
              >
                Sign as {excursion.requiredRole} — {excursion.recommendedDisposition}
              </button>
              <button onClick={() => sign(true)} disabled={busy} className="lc-btn disabled:opacity-50">
                Let Bob try
              </button>
            </div>

            {outcome?.kind === "signed" && (
              <p className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
                Signed and written to the audit chain ·{" "}
                <span className="font-mono">{outcome.hash.slice(0, 12)}</span>
              </p>
            )}
            {outcome?.kind === "refused" && (
              <p className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                <strong>Refused</strong> — {outcome.message}
                {outcome.actor === "bob" && (
                  <> The refusal is now in the audit trail below, attributed to the agent.</>
                )}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm lc-muted">No open excursion. Cargo is within its profile range.</p>
      )}
    </section>
  );
}
