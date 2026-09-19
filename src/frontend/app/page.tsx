"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TimeBar } from "@/components/TimeBar";
import { TriageQueue } from "@/components/TriageQueue";
import { AuditPanel } from "@/components/AuditPanel";
import { api, type Health, type WorldSnapshot } from "@/lib/api";

// Leaflet touches window on import, so it can only load in the browser.
const MovingMap = dynamic(() => import("@/components/MovingMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-lg border border-slate-700/50 bg-slate-900/30">
      <span className="text-sm opacity-60">Loading map…</span>
    </div>
  ),
});

/**
 * Control Tower.
 *
 * One screen answering one question: which shipments need a decision, and how
 * long do I have? Everything here is engine output — the life clocks, the
 * severities, the money — read through lib/api.
 */
export default function ControlTowerPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setHealth(await api.health());
        setWorld(await api.world());
      } catch {
        setHealth(null);
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const moving = world?.shipments.filter((s) => s.moving).length ?? 0;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          LIFECLOCK
          <span className="ml-3 text-base font-normal opacity-60">cold-chain control tower</span>
        </h1>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <a href="/classic" className="underline opacity-60 hover:opacity-100">
            classic map view
          </a>
          {health ? (
            <>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
                {moving} shipments moving
              </span>
              <span className="opacity-60">
                store: {health.store} · ai: {health.ai}
              </span>
            </>
          ) : (
            <span className="text-red-400">backend unreachable</span>
          )}
        </div>
      </header>

      <TimeBar />

      {health?.ai === "fallback" && (
        <p className="rounded border border-slate-600/40 bg-slate-800/30 px-4 py-2 text-sm opacity-80">
          Running without watsonx credentials. Every number on this screen is produced by the
          deterministic engines; only the written explanations fall back to templates.
        </p>
      )}

      <MovingMap selected={selected} onSelect={setSelected} />

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <TriageQueue onSelect={setSelected} />
        <AuditPanel />
      </div>
    </main>
  );
}
