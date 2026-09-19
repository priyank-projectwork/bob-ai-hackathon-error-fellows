"use client";
import { useEffect, useState } from "react";
import { api, type SimStatus } from "@/lib/api";

const SPEEDS = [1, 60, 600, 1800];

/**
 * The time controls. The world runs on a simulated clock, so a demo minute can
 * be an hour of shipment time — and an incident can be replayed rather than
 * waited for.
 */
export function TimeBar({ onTick }: { onTick?: (s: SimStatus) => void }) {
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const s = await api.sim.status();
      setStatus(s);
      setError(null);
      onTick?.(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "backend unreachable");
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<SimStatus>) => {
    try {
      setStatus(await fn());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    }
  };

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm">
        <span className="font-medium text-red-400">Backend unreachable</span>
        <span className="opacity-70">{error}</span>
        <button onClick={refresh} className="ml-auto rounded bg-red-500/20 px-3 py-1 hover:bg-red-500/30">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-2">
      <button
        onClick={() => act(status?.running ? api.sim.pause : api.sim.play)}
        className="rounded bg-slate-700 px-4 py-1.5 text-sm font-medium hover:bg-slate-600"
        aria-label={status?.running ? "Pause the simulation" : "Play the simulation"}
      >
        {status?.running ? "Pause" : "Play"}
      </button>

      <div className="flex items-center gap-1" role="group" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => act(() => api.sim.speed(s))}
            aria-pressed={status?.speed === s}
            className={`rounded px-2.5 py-1 text-sm ${
              status?.speed === s ? "bg-sky-600 text-white" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            {s}&times;
          </button>
        ))}
      </div>

      <button onClick={() => act(() => api.sim.skip(6))} className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">
        +6 h
      </button>

      <div className="ml-auto flex items-center gap-3 font-mono text-sm tabular-nums">
        <span className={`h-2 w-2 rounded-full ${status?.running ? "bg-emerald-400" : "bg-slate-500"}`} aria-hidden />
        <span>{status ? new Date(status.simNowMs).toISOString().replace("T", " ").slice(0, 16) : "—"}</span>
        <span className="opacity-60">+{status ? status.elapsedSimHours.toFixed(1) : "0"} h</span>
      </div>
    </div>
  );
}
