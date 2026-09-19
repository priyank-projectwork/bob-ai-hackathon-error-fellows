"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TimeBar } from "@/components/TimeBar";
import { TriageQueue } from "@/components/TriageQueue";
import { AuditPanel } from "@/components/AuditPanel";
import { KpiStrip } from "@/components/KpiStrip";
import { ShipmentDetail } from "@/components/ShipmentDetail";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, type Health, type LifeClock, type MovingShipment } from "@/lib/api";

// Leaflet touches window on import, so it can only load in the browser.
const MovingMap = dynamic(() => import("@/components/MovingMap"), {
  ssr: false,
  loading: () => (
    <div className="lc-card flex h-[520px] items-center justify-center">
      <span className="text-sm lc-subtle">Loading map…</span>
    </div>
  ),
});

/**
 * Control Tower.
 *
 * ONE poller feeds every panel. Each component used to fetch for itself, so
 * /world and /lifeclock were each requested twice on different intervals and
 * the header and the map disagreed about how many shipments were moving for
 * two seconds out of every four.
 */
export default function TowerPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [shipments, setShipments] = useState<MovingShipment[]>([]);
  const [clocks, setClocks] = useState<LifeClock[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [auditKey, setAuditKey] = useState(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [h, w, lc] = await Promise.allSettled([api.health(), api.world(), api.lifeClocks()]);
      if (!alive) return;
      if (h.status === "fulfilled") { setHealth(h.value); setOffline(false); } else setOffline(true);
      if (w.status === "fulfilled") setShipments(w.value.shipments.filter((s) => s.position));
      if (lc.status === "fulfilled") setClocks(lc.value.clocks);
    };
    load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const toggle = useCallback((id: string) => setSelected((p) => (p === id ? null : id)), []);
  const bumpAudit = useCallback(() => setAuditKey((k) => k + 1), []);
  const moving = shipments.filter((s) => s.moving).length;

  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">LIFECLOCK</h1>
          <p className="text-sm lc-muted">
            Every cold shipment has two deadlines. This is the one that bites first.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {offline ? (
            <span className="lc-chip lc-chip-danger">backend unreachable</span>
          ) : (
            health && (
              <span className="lc-subtle">
                {health.store} · {health.ai}
              </span>
            )
          )}
          <ThemeToggle />
          <a href="/" className="lc-muted underline hover:text-[var(--text)]">
            main dashboard
          </a>
        </div>
      </header>

      {/* The value proposition as numbers, above the fold. */}
      <KpiStrip clocks={clocks} moving={moving} />

      {health?.ai === "fallback" && (
        <p className="lc-card px-4 py-2.5 text-sm lc-muted">
          Running without watsonx credentials. Every number here is produced by the deterministic
          engines; only the written explanations fall back to templates.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_1.25fr]">
        <div className="flex flex-col gap-5">
          <TriageQueue clocks={clocks} selected={selected} onSelect={toggle} />
        </div>
        <div className="flex flex-col gap-5">
          <MovingMap shipments={shipments} clocks={clocks} selected={selected} onSelect={toggle} />
          {selected ? (
            <ShipmentDetail shipmentId={selected} onClose={() => setSelected(null)} onAction={bumpAudit} />
          ) : (
            <div className="lc-card p-6 text-sm lc-muted">
              Select a shipment to see both clocks, its excursion, and what the rule says to do
              about it.
            </div>
          )}
          <AuditPanel key={auditKey} />
        </div>
      </div>

      {/* Simulation controls are chrome, not the point of the screen. */}
      <TimeBar />
    </main>
  );
}
