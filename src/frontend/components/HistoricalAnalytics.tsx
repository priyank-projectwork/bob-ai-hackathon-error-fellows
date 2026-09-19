"use client";

import React, { useEffect, useState } from "react";
import { API } from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

const SAFE_MAX = 8;
const WARN_MIN = 7;

// One colour per shipment — consistent across renders
/**
 * A stable colour per shipment, derived from its id.
 *
 * This used to be a fixed map keyed on SHIP-MVP-101..106. Those ids no longer
 * exist, so every series fell through to the same grey and the chart became
 * unreadable. Hashing the id means any shipment gets a distinct, consistent
 * colour without anyone maintaining a list.
 */
const SERIES_PALETTE = [
  "#818cf8", // indigo
  "#34d399", // emerald
  "#60a5fa", // blue
  "#f472b6", // pink
  "#fbbf24", // amber
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#c084fc", // purple
  "#f87171", // red
  "#a3e635", // lime
];

function colourFor(shipmentId: string): string {
  let h = 0;
  for (let i = 0; i < shipmentId.length; i++) {
    h = (h * 31 + shipmentId.charCodeAt(i)) >>> 0;
  }
  return SERIES_PALETTE[h % SERIES_PALETTE.length];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="lc-bg-panel border lc-hair rounded-lg px-3 py-2 text-xs shadow-xl min-w-[160px]">
      <div className="lc-ink-3 mb-1.5">{label}</div>
      {payload.map((p: any) => {
        const t = p.value as number;
        const isExcursion = t > SAFE_MAX;
        const isWarn = !isExcursion && t > WARN_MIN;
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-3 mb-0.5">
            <span className="font-mono text-[9px]" style={{ color: p.color }}>{p.dataKey}</span>
            <span className="font-bold tabular-nums" style={{ color: isExcursion ? "#f87171" : isWarn ? "#fbbf24" : p.color }}>
              {t?.toFixed(1)}°C
              {isExcursion && <span className="ml-1 text-red-400 font-bold">[!]</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function HistoricalAnalytics() {
  const [data, setData]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/analytics/temperature`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setData(json.data);
      })
      .catch((err) => console.error("Error fetching analytics:", err))
      .finally(() => setLoading(false));
  }, []);

  // Derive which shipment keys are present in the data
  const shipmentKeys = data.length > 0
    ? Object.keys(data[0]).filter(k => k !== "time")
    : [];

  return (
    <div className="rounded-xl border lc-hair/80 lc-bg-panel overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b lc-hair lc-bg-sunk/40">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest lc-ink-2">Shipment Temperature Trends</h2>
          <p className="text-[11px] lc-ink-3 mt-0.5">
            Avg cargo temp per shipment · last 24 h · {shipmentKeys.length > 0 ? `${shipmentKeys.length} shipments tracked` : "all active shipments"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest lc-ink-3">
            <span className="flex items-center gap-1.5"><span className="inline-block w-6 border-t border-dashed border-red-500/60" />Excursion (8°C)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-6 border-t border-dashed border-amber-400/50" />Watch (7°C)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Live</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-4 py-4">
        {loading ? (
          <div className="h-56 flex items-center justify-center gap-2 lc-ink-3 text-xs">
            <div className="w-4 h-4 border lc-hair border-t-blue-600 rounded-full animate-spin" />
            Loading historical data…
          </div>
        ) : data.length === 0 ? (
          <div className="h-56 flex items-center justify-center lc-ink-3 text-xs">
            No data available — trigger a scenario to generate telemetry
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="time"
                  stroke="#334155"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#475569" }}
                />
                <YAxis
                  stroke="#334155"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 16]}
                  unit="°C"
                  tick={{ fill: "#475569" }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "9px", paddingTop: "8px" }}
                  formatter={(value) => <span style={{ color: "#94a3b8", fontSize: "9px" }}>{value}</span>}
                />
                {/* Threshold lines */}
                <ReferenceLine y={SAFE_MAX} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} strokeWidth={1} />
                <ReferenceLine y={WARN_MIN} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.4} strokeWidth={1} />
                {/* One line per shipment */}
                {shipmentKeys.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stroke={colourFor(key)}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 1 }}
                    animationDuration={800}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
