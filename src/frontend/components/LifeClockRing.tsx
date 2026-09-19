"use client";
import type { ClockState } from "@/lib/api";

const STATE_COLOR: Record<ClockState, string> = {
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  black: "#7f1d1d",
};

/**
 * The life clock as a ring. The arc is how much usable cargo life is left
 * against a 48-hour reference, so a shipment going from green to red is a
 * visible change rather than a number that moves.
 */
export function LifeClockRing({
  hours,
  state,
  size = 72,
  label,
}: {
  hours: number;
  state: ClockState;
  size?: number;
  label?: string;
}) {
  const REFERENCE_H = 48;
  const pct = Math.max(0, Math.min(1, hours / REFERENCE_H));
  const r = size / 2 - 6;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * pct;
  const colour = STATE_COLOR[state];

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} role="img" aria-label={`Life clock ${hours.toFixed(1)} hours, ${state}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-700/40" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 600ms ease, stroke 400ms ease" }}
        />
        <text
          x="50%" y="48%" textAnchor="middle" dominantBaseline="middle"
          className="fill-current font-semibold" style={{ fontSize: size * 0.26 }}
        >
          {hours <= 0 ? "0" : hours.toFixed(hours < 10 ? 1 : 0)}
        </text>
        <text
          x="50%" y="68%" textAnchor="middle" dominantBaseline="middle"
          className="fill-current opacity-60" style={{ fontSize: size * 0.15 }}
        >
          hrs
        </text>
      </svg>
      {label && <span className="text-xs opacity-70">{label}</span>}
    </div>
  );
}

/**
 * Both clocks side by side, with the binding one marked. This split is the
 * product's whole idea: "late" and "spoiled" are different deadlines, and
 * which one bites first decides what you should do.
 */
export function TwoClocks({
  scheduleH,
  stabilityH,
  binding,
}: {
  scheduleH: number;
  stabilityH: number;
  binding: "schedule" | "stability";
}) {
  const Row = ({ name, hours, isBinding }: { name: string; hours: number; isBinding: boolean }) => (
    <div className={`flex items-baseline justify-between gap-4 rounded px-2 py-1 ${isBinding ? "bg-amber-500/15 ring-1 ring-amber-500/40" : ""}`}>
      <span className="text-sm">
        {name}
        {isBinding && <span className="ml-2 text-xs font-medium text-amber-400">binding</span>}
      </span>
      <span className="font-mono text-sm tabular-nums">{hours.toFixed(1)} h</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <Row name="Until late" hours={scheduleH} isBinding={binding === "schedule"} />
      <Row name="Until spoiled" hours={stabilityH} isBinding={binding === "stability"} />
    </div>
  );
}
