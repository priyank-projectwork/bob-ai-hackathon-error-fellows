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

  // A stale backend is the single most common reason the controls do nothing,
  // so say so plainly rather than sitting there inert.
  if (error) {
    return (
      <div className="lc-card flex items-center gap-3 px-4 py-2.5 text-sm" style={{ borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
        <span className="font-semibold" style={{ color: "var(--danger)" }}>
          Simulation controls unavailable
        </span>
        <span className="lc-muted">
          {/(404|not found)/i.test(error)
            ? "the backend is running an older build — restart it (npm start in src/backend)"
            : error}
        </span>
        <button onClick={refresh} className="lc-btn ml-auto">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="lc-card flex flex-wrap items-center gap-3 px-4 py-2.5">
      <button
        onClick={() => act(status?.running ? api.sim.pause : api.sim.play)}
        className="lc-btn is-active min-w-[5rem] font-semibold"
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
            className="lc-btn px-2.5 py-1"
          >
            {s}&times;
          </button>
        ))}
      </div>

      <button onClick={() => act(() => api.sim.skip(6))} className="lc-btn">
        +6 h
      </button>

      <div className="ml-auto flex items-center gap-3 font-mono text-sm tabular-nums">
        <span className="h-2 w-2 rounded-full" style={{ background: status?.running ? "var(--ok)" : "var(--text-subtle)" }} aria-hidden />
        <span>{status ? new Date(status.simNowMs).toISOString().replace("T", " ").slice(0, 16) : "—"}</span>
        <span className="lc-subtle">+{status ? status.elapsedSimHours.toFixed(1) : "0"} h</span>
      </div>
    </div>
  );
}
