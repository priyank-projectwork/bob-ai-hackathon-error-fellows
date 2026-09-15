"use client";

import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

const SAFE_MAX = 8;
const WARN_MIN = 7;

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const t = payload[0].value as number;
  const isExcursion = t > SAFE_MAX;
  const isWarn      = t > WARN_MIN && t <= SAFE_MAX;
  const color       = isExcursion ? "#f87171" : isWarn ? "#fbbf24" : "#34d399";
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-slate-500 mb-1">{label}</div>
      <div className="font-bold tabular-nums" style={{ color }}>
        {t?.toFixed(2)}°C
        {isExcursion && <span className="ml-1 text-red-400 font-bold">[EXCURSION]</span>}
        {isWarn && <span className="ml-1 text-amber-400">[WATCH]</span>}
      </div>
    </div>
  );
}

export default function HistoricalAnalytics() {
  const [data, setData]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://127.0.0.1:4000/api/analytics/temperature")
      .then((res) => res.json())
      .then((json) => { if (json.data) setData(json.data); })
      .catch((err) => console.error("Error fetching analytics:", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-800/40">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Fleet Temperature Trends</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">Avg cargo temperature · last 24 h</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            <span className="flex items-center gap-1.5"><span className="inline-block w-6 border-t border-dashed border-red-500/60" />Excursion threshold (8°C)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-6 border-t border-dashed border-amber-400/50" />Watch threshold (7°C)</span>
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
          <div className="h-56 flex items-center justify-center gap-2 text-slate-600 text-xs">
            <div className="w-4 h-4 border border-slate-700 border-t-blue-600 rounded-full animate-spin" />
            Loading historical data…
          </div>
        ) : data.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-slate-600 text-xs">
            No data available — trigger a scenario to generate telemetry
          </div>
        ) : (
          <div className="h-64 w-full">
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
                  domain={["auto", "auto"]}
                  unit="°C"
                  tick={{ fill: "#475569" }}
                />
                <Tooltip content={<CustomTooltip />} />
                {/* Safe zone boundary */}
                <ReferenceLine
                  y={SAFE_MAX}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <ReferenceLine
                  y={WARN_MIN}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  strokeOpacity={0.4}
                  strokeWidth={1}
                />
                <Line
                  type="monotone"
                  dataKey="temp"
                  name="Avg Temp"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }}
                  animationDuration={1200}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
