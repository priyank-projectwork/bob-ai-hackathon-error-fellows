"use client";
import { useState } from "react";
import type { LifeClock } from "@/lib/api";
import { LifeClockRing, TwoClocks } from "./LifeClockRing";

const STATE_LABEL: Record<string, string> = {
  black: "Unusable",
  red: "Critical",
  amber: "Watch",
  green: "OK",
};

/**
 * The attention queue: every shipment ranked by how little usable cargo life
 * it has left. With hundreds in transit, nobody scrolls a list — the system
 * says what needs a decision and everything healthy collapses out of the way.
 */
export function TriageQueue({
  clocks,
  selected,
  onSelect,
}: {
  clocks: LifeClock[];
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const needsAttention = clocks.filter((c) => c.state !== "green");
  const healthy = clocks.length - needsAttention.length;
  const shown = showAll ? clocks : needsAttention;

  const totalUsd = clocks.reduce((s, c) => s + c.usdAtRisk, 0);
  const totalDoses = clocks.reduce((s, c) => s + c.dosesAtRisk, 0);

  return (
    <section className="flex flex-col gap-3" aria-label="Shipments needing attention">
      <header className="flex flex-wrap items-baseline gap-4">
        <h2 className="text-lg font-semibold">Needs a decision</h2>
        <span className="text-sm lc-muted">
          {needsAttention.length} of {clocks.length} shipments
        </span>
        <span className="ml-auto font-mono text-sm tabular-nums font-semibold">
          ${Math.round(totalUsd).toLocaleString()} at risk
          {totalDoses > 0 && <span className="lc-muted"> · {totalDoses.toLocaleString()} doses</span>}
        </span>
      </header>

      {shown.length === 0 && (
        <div className="lc-card p-8 text-center" style={{ borderColor: "var(--ok)", background: "var(--ok-bg)" }}>
          <p className="text-base font-semibold" style={{ color: "var(--ok)" }}>Nothing needs a decision right now.</p>
          <p className="mt-1.5 text-sm lc-muted">
            {clocks.length} shipments in transit, all within their stability and schedule margins.
          </p>
        </div>
      )}

      <ul className="flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1">
        {shown.map((c) => (
          <li key={c.shipmentId}>
            <button
              onClick={() => onSelect?.(c.shipmentId)}
              aria-pressed={selected === c.shipmentId}
              className="lc-card flex w-full items-center gap-4 p-3.5 text-left transition-colors hover:border-[var(--border-strong)]"
              style={
                selected === c.shipmentId
                  ? { borderColor: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--accent)" }
                  : undefined
              }
            >
              <LifeClockRing hours={c.lifeClockH} state={c.state} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono font-semibold">{c.shipmentId}</span>
                  <span className={`lc-chip ${
                    c.state === "black" || c.state === "red" ? "lc-chip-danger"
                    : c.state === "amber" ? "lc-chip-warn" : "lc-chip-ok"}`}>
                    {STATE_LABEL[c.state]}
                  </span>
                  {c.irreversible && (
                    <span className="lc-chip lc-chip-danger">irreversible</span>
                  )}
                  {c.severity !== "None" && (
                    <span className="lc-chip lc-chip-neutral">{c.severity} excursion</span>
                  )}
                </div>
                <div className="mt-1.5 text-sm lc-muted">
                  {c.profile.name} v{c.profile.version} ({c.profile.rangeC[0]}–{c.profile.rangeC[1]} °C)
                  {c.tempC !== null && <span className="ml-2 font-mono">now {c.tempC.toFixed(1)} °C</span>}
                </div>
                <div className="mt-2 max-w-sm">
                  <TwoClocks scheduleH={c.scheduleMarginH} stabilityH={c.stabilityMarginH} binding={c.bindingConstraint} />
                </div>
              </div>
              <div className="shrink-0 text-right font-mono text-sm tabular-nums">
                <div>${Math.round(c.usdAtRisk).toLocaleString()}</div>
                {c.dosesAtRisk > 0 && <div className="lc-muted">{c.dosesAtRisk.toLocaleString()} doses</div>}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {healthy > 0 && (
        <button onClick={() => setShowAll((v) => !v)} className="self-start text-sm lc-muted underline hover:text-[var(--text)]">
          {showAll ? "Hide" : `Show ${healthy} shipment${healthy === 1 ? "" : "s"} that are fine`}
        </button>
      )}
    </section>
  );
}
