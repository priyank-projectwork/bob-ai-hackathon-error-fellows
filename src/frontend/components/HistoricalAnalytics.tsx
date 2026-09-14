"use client";

import React, { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function HistoricalAnalytics() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://127.0.0.1:4000/api/analytics/temperature")
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          setData(json.data);
        }
      })
      .catch((err) => console.error("Error fetching analytics:", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl mt-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Fleet Temperature Trends</h2>
          <p className="text-sm text-slate-400">Average cargo temperature over the last 24 hours</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-sm text-emerald-400 font-semibold tracking-wide">LIVE</span>
        </div>
      </div>
      
      {loading ? (
        <div className="h-64 flex items-center justify-center text-slate-500">Loading historical data...</div>
      ) : data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-500">No data available.</div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke="#64748b" 
                fontSize={12} 
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="#64748b" 
                fontSize={12} 
                tickLine={false}
                axisLine={false}
                domain={['auto', 'auto']}
                unit="°C"
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f8fafc' }}
                itemStyle={{ color: '#818cf8', fontWeight: 'bold' }}
              />
              <Line 
                type="monotone" 
                dataKey="temp" 
                name="Avg Temp"
                stroke="#818cf8" 
                strokeWidth={3}
                dot={{ r: 4, fill: '#818cf8', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }}
                animationDuration={2000}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
