"use client";
import { useEffect, useState } from "react";
import { api, type LifeClock } from "@/lib/api";
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
export function TriageQueue({ onSelect }: { onSelect?: (id: string) => void }) {
  const [clocks, setClocks] = useState<LifeClock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await api.lifeClocks();
        setClocks(r.clocks);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not load");
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  if (error) {
    return <div className="rounded border border-red-500/40 bg-red-500/10 p-4 text-sm">Could not load life clocks: {error}</div>;
  }

  const needsAttention = clocks.filter((c) => c.state !== "green");
  const healthy = clocks.length - needsAttention.length;
  const shown = showAll ? clocks : needsAttention;

  const totalUsd = clocks.reduce((s, c) => s + c.usdAtRisk, 0);
  const totalDoses = clocks.reduce((s, c) => s + c.dosesAtRisk, 0);

  return (
    <section className="flex flex-col gap-3" aria-label="Shipments needing attention">
      <header className="flex flex-wrap items-baseline gap-4">
        <h2 className="text-lg font-semibold">Needs a decision</h2>
        <span className="text-sm opacity-70">
          {needsAttention.length} of {clocks.length} shipments
        </span>
        <span className="ml-auto font-mono text-sm tabular-nums">
          ${Math.round(totalUsd).toLocaleString()} at risk
          {totalDoses > 0 && <span className="opacity-70"> · {totalDoses.toLocaleString()} doses</span>}
        </span>
      </header>

      {shown.length === 0 && (
        <div className="rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-6 text-center">
          <p className="font-medium text-emerald-400">Nothing needs a decision right now.</p>
          <p className="mt-1 text-sm opacity-70">
            {clocks.length} shipments in transit, all within their stability and schedule margins.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {shown.map((c) => (
          <li key={c.shipmentId}>
            <button
              onClick={() => onSelect?.(c.shipmentId)}
              className="flex w-full items-center gap-4 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3 text-left hover:border-slate-500"
            >
              <LifeClockRing hours={c.lifeClockH} state={c.state} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono font-semibold">{c.shipmentId}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    c.state === "black" || c.state === "red" ? "bg-red-500/20 text-red-300"
                    : c.state === "amber" ? "bg-amber-500/20 text-amber-300"
                    : "bg-emerald-500/20 text-emerald-300"}`}>
                    {STATE_LABEL[c.state]}
                  </span>
                  {c.irreversible && (
                    <span className="rounded bg-red-900/50 px-2 py-0.5 text-xs text-red-200">irreversible</span>
                  )}
                  {c.severity !== "None" && (
                    <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{c.severity} excursion</span>
                  )}
                </div>
                <div className="mt-1 text-sm opacity-70">
                  {c.profile.name} v{c.profile.version} ({c.profile.rangeC[0]}–{c.profile.rangeC[1]} °C)
                  {c.tempC !== null && <span className="ml-2 font-mono">now {c.tempC.toFixed(1)} °C</span>}
                </div>
                <div className="mt-2 max-w-sm">
                  <TwoClocks scheduleH={c.scheduleMarginH} stabilityH={c.stabilityMarginH} binding={c.bindingConstraint} />
                </div>
              </div>
              <div className="shrink-0 text-right font-mono text-sm tabular-nums">
                <div>${Math.round(c.usdAtRisk).toLocaleString()}</div>
                {c.dosesAtRisk > 0 && <div className="opacity-70">{c.dosesAtRisk.toLocaleString()} doses</div>}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {healthy > 0 && (
        <button onClick={() => setShowAll((v) => !v)} className="self-start text-sm opacity-70 underline hover:opacity-100">
          {showAll ? "Hide" : `Show ${healthy} shipment${healthy === 1 ? "" : "s"} that are fine`}
        </button>
      )}
    </section>
  );
}
