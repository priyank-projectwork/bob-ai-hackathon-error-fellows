"use client";
import type { LifeClock } from "@/lib/api";

/**
 * Four numbers that answer "should I be worried right now".
 *
 * Deliberately not a wall of tiles: each one is something a duty officer acts
 * on, and the money figure is the one that gets a decision approved.
 */
export function KpiStrip({ clocks, moving }: { clocks: LifeClock[]; moving: number }) {
  const critical = clocks.filter((c) => c.state === "red" || c.state === "black").length;
  const watch = clocks.filter((c) => c.state === "amber").length;
  const usd = clocks.reduce((s, c) => s + c.usdAtRisk, 0);
  const doses = clocks.reduce((s, c) => s + c.dosesAtRisk, 0);

  const tiles = [
    {
      label: "Need a decision",
      value: critical.toString(),
      sub: watch > 0 ? `${watch} more on watch` : "nothing else pending",
      tone: critical > 0 ? "danger" : "ok",
    },
    {
      label: "In transit",
      value: moving.toString(),
      sub: `${clocks.length} tracked`,
      tone: "neutral",
    },
    {
      label: "Value at risk",
      value: `$${(usd / 1000).toFixed(0)}k`,
      sub: "probability-weighted",
      tone: usd > 250_000 ? "warn" : "neutral",
    },
    {
      label: "Doses at risk",
      value: doses > 0 ? doses.toLocaleString() : "—",
      sub: doses > 0 ? "vaccine cargo" : "no vaccine exposure",
      tone: doses > 50_000 ? "warn" : "neutral",
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="lc-card px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wide lc-subtle">{t.label}</div>
          <div
            className="mt-1 font-mono text-2xl font-semibold tabular-nums"
            style={{
              color:
                t.tone === "danger" ? "var(--danger)"
                : t.tone === "warn" ? "var(--warn)"
                : t.tone === "ok" ? "var(--ok)"
                : "var(--text)",
            }}
          >
            {t.value}
          </div>
          <div className="mt-0.5 text-xs lc-muted">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
