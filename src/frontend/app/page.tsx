"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import dynamic from "next/dynamic";
import ChatCopilot from "../components/ChatCopilot";
import HistoricalAnalytics from "../components/HistoricalAnalytics";

const LiveMap = dynamic(() => import("../components/LiveMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] rounded-xl bg-slate-800 animate-pulse border border-slate-700 flex items-center justify-center">
      <span className="text-slate-500 font-medium">Loading geospatial data...</span>
    </div>
  ),
});

interface SensorLog {
  shipmentId: string;
  timestamp: string;
  temperatureCelsius: number;
}

interface AlertData {
  _id: string;
  severity: "Normal" | "Watch" | "High" | "Critical";
  entityType: string;
  title: string;
  message: string;
  createdAt: string;
}

interface RecommendationData {
  _id: string;
  entityType: string;
  entityId: string;
  recommendationType: string;
  rationale: string;
  score: number;
  confidence?: number;
  evidence?: {
    alternateRoute?: { route: string; costDelta: number; timeDeltaHours: number; riskScore: number };
    fleetMatch?: { fleet: { assetId: string; locationName?: string }; matchScore: number; distanceKm: number };
  };
}

export default function Dashboard() {
  const [kpis, setKpis] = useState({ activeDisruptions: 0, idleAssets: 0, criticalShipments: 0, openColdChainAlerts: 0 });
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationData[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [fleets, setFleets] = useState<any[]>([]);
  const [disruptions, setDisruptions] = useState<any[]>([]);
  const [logs, setLogs] = useState<SensorLog[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  
  // Mock User Session
  const currentUser = "Operations Control Tower Manager";

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [locRes, cmdRes, auditRes] = await Promise.all([
          fetch("http://127.0.0.1:4000/api/locations"),
          fetch("http://127.0.0.1:4000/api/v1/command-center"),
          fetch("http://127.0.0.1:4000/api/v1/audit")
        ]);
        
        const locData = await locRes.json();
        const cmdData = await cmdRes.json();
        const auditData = await auditRes.json();
        
        setShipments(locData.shipments || []);
        setFleets(locData.fleets || []);
        setDisruptions(locData.disruptions || []);
        
        setKpis(cmdData.kpis);
        setAlerts(cmdData.alerts);
        setRecommendations(cmdData.recommendations);
        setAuditEvents(auditData.events || []);
      } catch (e) {
        console.error("Failed to fetch dashboard data:", e);
      }
    };
    fetchData();

    const socket = io("http://127.0.0.1:4000");

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("temperatureUpdate", (newLog: SensorLog) => {
      setLogs((prev) => [newLog, ...prev].slice(0, 15));
    });

    socket.on("telemetry.alert", (alertData: AlertData) => {
      setAlerts((prev) => [alertData, ...prev]);
      setKpis(prev => ({ ...prev, openColdChainAlerts: prev.openColdChainAlerts + 1 }));
    });

    socket.on("disruption.updated", (data: any) => {
      setDisruptions(prev => {
        const exists = prev.find(d => d._id === data.disruption._id);
        if (exists) return prev;
        return [data.disruption, ...prev];
      });
      setKpis(prev => ({ ...prev, activeDisruptions: prev.activeDisruptions + 1 }));
    });
    
    socket.on("recommendation.created", (rec: RecommendationData) => {
      setRecommendations(prev => [rec, ...prev]);
    });

    socket.on("action.completed", (data: any) => {
      setRecommendations(prev => prev.filter(r => r._id !== data.recommendation._id));
      // Refresh audit trail
      fetch("http://127.0.0.1:4000/api/v1/audit")
        .then(r => r.json())
        .then(d => setAuditEvents(d.events || []))
        .catch(() => {});
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleTriggerDisruption = async (disruptionType: string, location: string) => {
    setIsTriggering(true);
    try {
      await fetch("http://127.0.0.1:4000/api/disruptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disruptionType, location }),
      });
    } catch (error) {
      console.error("Error triggering disruption:", error);
    } finally {
      setIsTriggering(false);
    }
  };

  const approveRecommendation = async (id: string) => {
    try {
      await fetch(`http://127.0.0.1:4000/api/v1/recommendations/${id}/approve`, {
        method: "POST"
      });
    } catch (err) {
      console.error("Failed to approve action", err);
    }
  };

  const rejectRecommendation = async (id: string) => {
    try {
      await fetch(`http://127.0.0.1:4000/api/v1/recommendations/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Manually rejected by operator" })
      });
    } catch (err) {
      console.error("Failed to reject action", err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8 font-sans">
      <header className="mb-8 border-b border-slate-700 pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-white">Cold Chain Monitor</h1>
          <p className="text-slate-400 mt-1">
            Live IoT Telemetry & AI Disruption Assistant — <span className="text-blue-400">{currentUser}</span>
          </p>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="text-sm text-slate-400 font-medium">Scenario Triggers:</div>
            <button
              onClick={() => handleTriggerDisruption("Port Strike", "Los Angeles")}
              disabled={isTriggering}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-800 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
            >
              {isTriggering ? "Triggering..." : "⚠️ LA Port Strike"}
            </button>
            <button
              onClick={() => handleTriggerDisruption("Blizzard", "Chicago")}
              disabled={isTriggering}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
            >
              {isTriggering ? "Triggering..." : "❄️ Chicago Blizzard"}
            </button>
            <button
              onClick={() => handleTriggerDisruption("Hurricane", "Miami")}
              disabled={isTriggering}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
            >
              {isTriggering ? "Triggering..." : "🌪️ Miami Hurricane"}
            </button>
          </div>

          <div className="flex items-center gap-2 border-l border-slate-700 pl-6">
            <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`}></div>
            <span className="text-sm font-medium">
              {isConnected ? "Live Connection" : "Disconnected"}
            </span>
          </div>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm">
          <div className="text-sm text-slate-400 mb-1">Active Disruptions</div>
          <div className="text-3xl font-bold text-amber-500">{kpis.activeDisruptions}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm">
          <div className="text-sm text-slate-400 mb-1">Idle Fleet Assets</div>
          <div className="text-3xl font-bold text-green-400">{kpis.idleAssets}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm">
          <div className="text-sm text-slate-400 mb-1">Critical Shipments</div>
          <div className="text-3xl font-bold text-red-500">{kpis.criticalShipments}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm">
          <div className="text-sm text-slate-400 mb-1">Cold Chain Alerts</div>
          <div className="text-3xl font-bold text-blue-400">{kpis.openColdChainAlerts}</div>
        </div>
      </div>

      <div className="mb-8">
        <LiveMap disruptions={disruptions} shipments={shipments} fleets={fleets} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Action Center */}
        <div className="lg:col-span-2 space-y-8">
          
          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">AI Action Center</h2>
            {recommendations.length === 0 ? (
              <div className="p-8 border border-slate-800 rounded-xl bg-slate-800/50 text-center text-slate-500">
                No pending actions required. System is operating optimally.
              </div>
            ) : (
              recommendations.map((rec) => (
                <div key={rec._id} className="p-5 border-l-4 rounded-r-xl bg-slate-800 border-indigo-500 shadow-lg mb-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 block mb-1">
                        Recommendation: {rec.recommendationType}
                      </span>
                      <h3 className="font-bold text-white text-lg">
                        {rec.entityType} {rec.entityId}
                      </h3>
                    </div>
                    <span className="bg-slate-900 px-3 py-1 rounded-lg text-sm text-slate-300 border border-slate-700">
                      Risk Score: <span className="font-bold text-amber-500">{rec.score}</span>
                    </span>
                  </div>
                  
                  <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 mb-3">
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {rec.rationale}
                    </p>
                  </div>

                  {/* Route + Fleet Evidence */}
                  {rec.evidence && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {rec.evidence.alternateRoute && (
                        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-700 text-xs">
                          <div className="text-indigo-400 font-bold mb-1">🗺 Alternate Route</div>
                          <div className="text-slate-300">{rec.evidence.alternateRoute.route}</div>
                          <div className="text-slate-500 mt-1">
                            {rec.evidence.alternateRoute.costDelta > 0 ? `+$${rec.evidence.alternateRoute.costDelta}` : "No cost change"} · {rec.evidence.alternateRoute.timeDeltaHours > 0 ? `+${rec.evidence.alternateRoute.timeDeltaHours}h` : rec.evidence.alternateRoute.timeDeltaHours < 0 ? `${rec.evidence.alternateRoute.timeDeltaHours}h` : "Same ETA"} · Risk: {rec.evidence.alternateRoute.riskScore}
                          </div>
                        </div>
                      )}
                      {rec.evidence.fleetMatch && rec.evidence.fleetMatch.fleet && (
                        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-700 text-xs">
                          <div className="text-green-400 font-bold mb-1">🚛 Fleet Match</div>
                          <div className="text-slate-300">{rec.evidence.fleetMatch.fleet.assetId}</div>
                          <div className="text-slate-500 mt-1">
                            {rec.evidence.fleetMatch.fleet.locationName || "Nearby"} · Match score: {rec.evidence.fleetMatch.matchScore} · {rec.evidence.fleetMatch.distanceKm}km away
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => rejectRecommendation(rec._id)}
                      className="px-4 py-2 text-sm text-slate-400 hover:text-red-400 transition-colors border border-transparent hover:border-red-800 rounded-lg"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => approveRecommendation(rec._id)}
                      className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
                    >
                      Approve & Execute
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">Active Incidents & Alerts</h2>
            {alerts.length === 0 ? (
              <div className="p-8 border border-slate-800 rounded-xl bg-slate-800/50 text-center text-slate-500">
                No active incidents.
              </div>
            ) : (
              <div className="space-y-3">
              {alerts.slice(0, 8).map((alert, i) => {
                const borderClass =
                  alert.severity === "Critical" ? "border-red-500" :
                  alert.severity === "High"     ? "border-orange-500" :
                  alert.severity === "Watch"    ? "border-amber-400" :
                  "border-slate-600";
                const badgeClass =
                  alert.severity === "Critical" ? "bg-red-900/60 text-red-300" :
                  alert.severity === "High"     ? "bg-orange-900/60 text-orange-300" :
                  alert.severity === "Watch"    ? "bg-amber-900/60 text-amber-300" :
                  "bg-slate-700 text-slate-400";
                return (
                  <div key={i} className={`p-4 border-l-4 rounded-r-lg bg-slate-800 shadow-sm ${borderClass}`}>
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${badgeClass}`}>{alert.severity}</span>
                        <h3 className="font-semibold text-white text-sm">{alert.title}</h3>
                      </div>
                      <span className="text-xs text-slate-500 flex-shrink-0 ml-2">{new Date(alert.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed mt-1">{alert.message}</p>
                  </div>
                );
              })}
              </div>
            )}
          </div>
          
        </div>

        {/* Right Column: Raw Data Stream */}
        <div>
          <h2 className="text-xl font-semibold mb-4 text-white">Live Sensor Feed</h2>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
            {logs.map((log, i) => {
              const t = log.temperatureCelsius;
              const isExcursion = t > 8.0;
              const isWarning   = t > 7.0 && t <= 8.0;
              const tempColor   = isExcursion ? "text-red-400" : isWarning ? "text-amber-400" : "text-green-400";
              const borderColor = isExcursion ? "border-red-800 bg-red-950/30" : isWarning ? "border-amber-800 bg-amber-950/20" : "border-slate-700 bg-slate-800/50";
              return (
                <div key={i} className={`p-3 rounded-lg border flex justify-between items-center ${borderColor}`}>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-400">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`font-mono font-bold ${tempColor}`}>
                      {t}°C {isExcursion ? "🔴" : isWarning ? "🟡" : ""}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {log.shipmentId}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <HistoricalAnalytics />

      {/* Audit Trail */}
      <div className="mt-8 mb-24">
        <h2 className="text-xl font-semibold mb-4 text-white">Audit Trail</h2>
        {auditEvents.length === 0 ? (
          <div className="p-6 border border-slate-800 rounded-xl bg-slate-800/50 text-center text-slate-500 text-sm">
            No audit events yet. Approve or reject a recommendation to generate an audit record.
          </div>
        ) : (
          <div className="space-y-2">
            {auditEvents.slice(0, 10).map((evt: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-800/60 border border-slate-700 rounded-lg text-sm">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    evt.eventType === "ApproveRecommendation" ? "bg-green-900/60 text-green-400" :
                    evt.eventType === "RejectRecommendation" ? "bg-red-900/60 text-red-400" :
                    "bg-slate-700 text-slate-300"
                  }`}>{evt.eventType}</span>
                  <span className="text-slate-400">{evt.entityType}</span>
                  <span className="text-slate-500 font-mono text-xs">{String(evt.entityId).slice(-8)}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-slate-500 text-xs">{evt.actorType}</span>
                  <span className="text-slate-600 text-xs">{new Date(evt.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ChatCopilot />
    </div>
  );
}
