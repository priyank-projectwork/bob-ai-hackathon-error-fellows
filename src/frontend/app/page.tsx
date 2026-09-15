"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import dynamic from "next/dynamic";
import ChatCopilot from "../components/ChatCopilot";
import HistoricalAnalytics from "../components/HistoricalAnalytics";
import TourOverlay from "../components/TourOverlay";

const LiveMap = dynamic(() => import("../components/LiveMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[460px] bg-[#0a0f1a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-slate-600 text-xs font-medium tracking-widest uppercase">Loading map…</span>
      </div>
    </div>
  ),
});

function calcZoomForRadius(radiusKm: number): number {
  const z = Math.floor(Math.log2(40075 / (radiusKm * 2)) - 1);
  return Math.max(5, Math.min(11, z));
}

// ── Types ──────────────────────────────────────────────────────────────────────

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
  status?: "Pending" | "Approved" | "Rejected" | "Superseded";
  evidence?: {
    alternateRoute?: { route: string; costDelta: number; timeDeltaHours: number; riskScore: number; via?: string[]; modes?: string[] };
    fleetMatch?: { fleet: { assetId: string; locationName?: string }; matchScore: number; distanceKm: number };
  };
}

// ── Severity helpers ───────────────────────────────────────────────────────────

const SEV_BADGE: Record<AlertData["severity"], string> = {
  Critical: "bg-red-500/15 text-red-400 ring-1 ring-red-500/30",
  High:     "bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30",
  Watch:    "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30",
  Normal:   "bg-slate-700 text-slate-400",
};
const SEV_BORDER: Record<AlertData["severity"], string> = {
  Critical: "border-red-800/40 bg-red-950/10",
  High:     "border-orange-800/30 bg-orange-950/10",
  Watch:    "border-amber-800/30 bg-amber-950/10",
  Normal:   "border-slate-800 bg-slate-900/20",
};

// ── Small reusable components ──────────────────────────────────────────────────

function ScoreMeter({ value }: { value: number }) {
  const color = value >= 75 ? "#f87171" : value >= 50 ? "#fb923c" : value >= 25 ? "#fbbf24" : "#34d399";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

function LiveClock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (!t) return null;
  return <span className="text-[11px] font-mono text-slate-500 tabular-nums">{t}</span>;
}

function SectionHeader({ title, count, live }: { title: string; count?: number; live?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</span>
        {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
      </div>
      {count !== undefined && count > 0 && (
        <span className="text-[10px] font-bold text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded-full">{count}</span>
      )}
    </div>
  );
}

function AlertRow({ alert, isNew }: { alert: AlertData; isNew: boolean }) {
  return (
    <div className={`flex gap-3 px-3 py-2.5 rounded-lg border text-[11px] leading-snug ${SEV_BORDER[alert.severity]} ${isNew ? "anim-slide-down" : ""}`}>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest flex-shrink-0 h-fit mt-0.5 ${SEV_BADGE[alert.severity]}`}>
        {alert.severity}
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-slate-200 truncate">{alert.title}</div>
        <div className="text-slate-500 truncate">{alert.message}</div>
      </div>
    </div>
  );
}

function SensorRow({ log, isNew }: { log: SensorLog; isNew: boolean }) {
  const t = log.temperatureCelsius;
  const over = t > 8, warn = !over && t > 7;
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg border
      ${over ? "border-red-900/40 bg-red-950/10" : warn ? "border-amber-900/30" : "border-slate-800/40"}
      ${isNew ? "anim-slide-right" : ""}`}>
      <span className="text-[10px] font-mono text-slate-500 truncate max-w-[90px]">{log.shipmentId}</span>
      <span className={`text-[12px] font-bold tabular-nums ${over ? "text-red-400" : warn ? "text-amber-400" : "text-emerald-400"}`}>
        {t.toFixed(1)}°C
      </span>
    </div>
  );
}

// ── Simulation steps toast ─────────────────────────────────────────────────────

const SIM_STEPS = [
  "Detecting impact zone…",
  "Scoring shipment risk…",
  "Optimising routes…",
  "Generating AI recommendation…",
  "Done ✓",
];

function SimToast({ step, label }: { step: number; label: string }) {
  if (step < 0) return null;
  const done = step >= SIM_STEPS.length - 1;
  return (
    <div className={`
      fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]
      flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl shadow-black/60
      border backdrop-blur-md text-[12px] font-semibold
      ${done ? "bg-emerald-950/90 border-emerald-700/50 text-emerald-300" : "bg-[#0b1424]/95 border-slate-700/60 text-slate-200"}
    `}>
      {!done
        ? <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-600 border-t-blue-400 animate-spin flex-shrink-0" />
        : <span className="text-emerald-400">✓</span>}
      <div>
        <span className="font-bold">{label}</span>
        <span className="text-slate-500 font-normal ml-2">{SIM_STEPS[Math.min(step, SIM_STEPS.length - 1)]}</span>
      </div>
    </div>
  );
}

// ── Recommendation card with inline expand ────────────────────────────────────

// Detect transport mode(s) from route string — returns primary mode info + multimodal flag
function getModeInfo(routeStr: string = "", origin: string = "", modes?: string[]): {
  icon: React.ReactNode; label: string; color: string; isMultiModal: boolean
} {
  const r = routeStr.toLowerCase();
  const isMultiModal = !!(modes && modes.length > 1);

  // Multi-modal: show combined icon badge
  if (isMultiModal) {
    const hasAir = modes!.includes("Air");
    const hasSea = modes!.includes("Sea");
    return {
      icon: (
        <span className="flex items-center gap-0.5">
          {hasSea && <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2 20a2 2 0 002 2h16a2 2 0 002-2M5 20V10h14v10M8 10V6l4-4 4 4v4"/></svg>}
          {hasAir && <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5S18 2 16.5 3.5L13 7 4.8 5.2A1 1 0 004 6l3 4.5-4 4V16l4-1 4 3h2l1-5.2z"/></svg>}
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/></svg>
        </span>
      ),
      label: modes!.join(" + "), color: "text-violet-400", isMultiModal: true,
    };
  }

  if (r.includes("[air]") || r.includes("air freight") || (r.includes("air") && r.includes("lax")))
    return { icon: (<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5S18 2 16.5 3.5L13 7 4.8 5.2A1 1 0 004 6l3 4.5-4 4V16l4-1 4 3h2l1-5.2z"/></svg>),
      label: "Air Freight", color: "text-sky-400", isMultiModal: false };

  if (r.includes("[sea]") || r.includes("ocean") || r.includes("pacific") || r.includes("vessel") ||
      origin === "Shanghai" || origin === "Tokyo" || origin === "Singapore" || origin === "Busan")
    return { icon: (<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2 20a2 2 0 002 2h16a2 2 0 002-2M5 20V10h14v10M8 10V6l4-4 4 4v4"/></svg>),
      label: "Ocean Vessel", color: "text-blue-400", isMultiModal: false };

  return { icon: (<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/></svg>),
    label: "Road Freight", color: "text-emerald-400", isMultiModal: false };
}

// Build a readable "Origin → ... → Destination" chain from the full route string
function RouteChain({ route, color = "text-slate-300" }: { route: string; color?: string }) {
  const parts = route.split("→").map(s => s.trim()).filter(Boolean);
  return (
    <span className="flex flex-wrap items-center gap-0.5 leading-snug">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-0.5">
          <span className={`text-[9px] font-semibold ${color}`}>{p}</span>
          {i < parts.length - 1 && (
            <span className="text-slate-600 text-[9px] font-bold mx-0.5">→</span>
          )}
        </span>
      ))}
    </span>
  );
}

function RecCard({ rec, shipment, disruption, onPreview, onReject, onApprove }: {
  rec: RecommendationData;
  shipment?: any;
  disruption?: any;
  onPreview: () => void;
  onReject: () => void;
  onApprove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const alt   = rec.evidence?.alternateRoute;
  const fleet = rec.evidence?.fleetMatch;

  const origin      = shipment?.origin      ?? "";
  const destination = shipment?.destination ?? "";
  const carrier     = shipment?.carrier     ?? "";
  const cargoType   = shipment?.cargoType   ?? "";
  const priority    = shipment?.priority    ?? "";
  const cargoValue  = shipment?.cargoValue  ?? 0;

  // Disruption details
  const disruptionType  = disruption?.type  ?? "Active Disruption";
  const disruptionTitle = disruption?.title ?? disruption?.type ?? "disruption";

  // Before route = the direct route that was blocked
  const beforeRoute = origin && destination ? `${origin} → ${destination}` : "Direct route";

  // Transport mode for BEFORE (original) and AFTER (AI fix)
  const beforeMode = getModeInfo(beforeRoute, origin);
  const afterMode  = getModeInfo(alt?.route ?? "", origin, alt?.modes);

  // Priority badge colour
  const priorityColor = priority === "Critical" ? "text-red-400 bg-red-500/10 ring-1 ring-red-500/20"
    : priority === "High"     ? "text-orange-400 bg-orange-500/10 ring-1 ring-orange-500/20"
    : "text-slate-400 bg-slate-800";

  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 overflow-hidden anim-slide-down">

      {/* ── Problem banner ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-2 border-b border-red-900/20 bg-red-950/10">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-red-400/80">
          {disruptionType} blocks this route
        </span>
        <span className="ml-auto text-[9px] font-mono text-slate-600">{rec.entityId}</span>
      </div>

      {/* ── Cargo info strip ───────────────────────────────────────────────── */}
      {(carrier || cargoType || priority) && (
        <div className="flex items-center gap-2 px-3.5 pt-2 pb-0.5 flex-wrap">
          {priority && (
            <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${priorityColor}`}>
              {priority}
            </span>
          )}
          {cargoType && <span className="text-[9px] text-slate-500">{cargoType}</span>}
          {cargoValue > 0 && (
            <span className="text-[9px] text-slate-600 font-mono">${(cargoValue / 1000).toFixed(0)}k cargo</span>
          )}
          {carrier && <span className="text-[9px] text-slate-600 truncate ml-auto">{carrier}</span>}
        </div>
      )}

      {/* ── Header: type + risk score ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3.5 pt-1.5 pb-1.5 gap-2">
        <div className="text-[9px] font-bold uppercase tracking-widest text-indigo-400">{rec.recommendationType}</div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <span className="text-[9px] text-slate-600">Risk</span>
          <ScoreMeter value={rec.score} />
        </div>
      </div>

      {/* ── BEFORE / AI FIX comparison ─────────────────────────────────────── */}
      {alt && (
        <div className="mx-3.5 mb-2 rounded-lg overflow-hidden border border-slate-800/60">

          {/* BEFORE row — actual blocked route with mode icon */}
          <div className="px-2.5 py-2 bg-red-950/20 border-b border-red-900/20">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[8px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded flex-shrink-0">BEFORE</span>
              <span className={`flex items-center gap-1 ${beforeMode.color} opacity-70`}>
                {beforeMode.icon}
                <span className="text-[8px] font-semibold">{beforeMode.label}</span>
              </span>
              <span className="ml-auto text-[8px] text-red-500/70 font-bold">✕ BLOCKED</span>
            </div>
            <RouteChain route={beforeRoute} color="text-red-300/80" />
            {disruptionTitle && (
              <div className="text-[8px] text-red-400/60 mt-0.5">
                Disruption: {disruptionTitle}
              </div>
            )}
          </div>

          {/* AI FIX row — full reroute with mode icon + cost/time deltas */}
          <div className="px-2.5 py-2 bg-emerald-950/10">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[8px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded flex-shrink-0">AI FIX</span>
              <span className={`flex items-center gap-1 ${afterMode.color}`}>
                {afterMode.icon}
                <span className="text-[8px] font-semibold">{afterMode.label}</span>
              </span>
              {afterMode.isMultiModal && (
                <span className="text-[7px] font-bold uppercase tracking-widest text-violet-400 bg-violet-500/10 px-1 py-0.5 rounded border border-violet-500/20">Multi-Modal</span>
              )}
              {/* Priority-weighted selection hint */}
              {priority && (
                <span className="text-[7px] text-slate-600 ml-auto flex-shrink-0">
                  ranked by {priority === "Critical" ? "safety" : priority === "High" ? "risk+cost" : "cost"}
                </span>
              )}
            </div>
            {/* Cost / time deltas — prominent row */}
            <div className="flex items-center gap-3 mb-1">
              <span className={`text-[10px] font-bold tabular-nums ${alt.costDelta > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {alt.costDelta > 0 ? `+$${alt.costDelta.toLocaleString()}` : "no extra cost"}
              </span>
              <span className="text-slate-700 text-[9px]">·</span>
              <span className={`text-[10px] font-bold tabular-nums ${alt.timeDeltaHours > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {alt.timeDeltaHours > 0 ? `+${alt.timeDeltaHours}h` : `${Math.abs(alt.timeDeltaHours)}h faster`}
              </span>
              <span className="text-slate-700 text-[9px]">·</span>
              <span className="text-[9px] text-slate-500">Risk {alt.riskScore}/100</span>
            </div>
            <RouteChain route={alt.route} color="text-emerald-300/90" />
          </div>

          {/* Fleet assigned */}
          {fleet && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-cyan-950/10 border-t border-slate-800/60">
              <svg className="w-3 h-3 text-cyan-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 1M13 16l2 1M13 16V9a1 1 0 011-1h2.586a1 1 0 01.707.293l3 3a1 1 0 01.293.707V16"/>
              </svg>
              <span className="text-[8px] font-bold text-cyan-400 uppercase tracking-widest">Fleet Dispatched</span>
              <span className="text-[9px] text-cyan-300/80 font-semibold">{fleet.fleet.assetId}</span>
              {fleet.fleet.locationName && (
                <span className="text-[9px] text-slate-600 truncate flex-1">{fleet.fleet.locationName}</span>
              )}
              <span className="text-[9px] text-slate-600 flex-shrink-0">{fleet.distanceKm}km</span>
            </div>
          )}
        </div>
      )}

      {/* Fleet match strip (when no alt route) */}
      {fleet && !alt && (
        <div className="mx-3.5 mb-2 rounded-lg border border-slate-800/60 px-2.5 py-1.5 bg-cyan-950/10 flex items-center gap-2">
          <span className="text-[8px] font-bold text-cyan-400 bg-cyan-500/10 px-1 py-0.5 rounded flex-shrink-0">FLEET</span>
          <span className="text-[9px] text-cyan-300/80 font-semibold">{fleet.fleet.assetId}</span>
          {fleet.fleet.locationName && <span className="text-[9px] text-slate-600 truncate">{fleet.fleet.locationName}</span>}
          <span className="text-[9px] text-slate-600 ml-auto flex-shrink-0">{fleet.distanceKm}km</span>
        </div>
      )}

      {/* Rationale — collapsible */}
      <div className="px-3.5 pb-1.5">
        <p className={`text-[10px] text-slate-500 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
          {rec.rationale}
        </p>
        {rec.rationale.length > 100 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[9px] text-slate-700 hover:text-slate-400 mt-0.5 transition-colors"
          >
            {expanded ? "show less ↑" : "full rationale ↓"}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-3.5 pb-3 pt-1.5 border-t border-slate-800/50">
        <button
          data-tour="see-on-map"
          onClick={onPreview}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-sky-400 border border-sky-900/40 bg-sky-950/20 hover:bg-sky-900/30 rounded-lg transition-colors"
          title="See blocked route vs AI reroute on the map"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0M12 8v4l3 3"/>
          </svg>
          See on Map
        </button>
        <button
          onClick={onReject}
          className="px-2.5 py-1.5 text-[10px] font-semibold text-slate-500 hover:text-red-400 border border-slate-800 hover:border-red-900/40 rounded-lg transition-colors"
        >
          Reject
        </button>
        <button
          onClick={onApprove}
          className="flex-1 py-1.5 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-600/20"
        >
          ✓ Approve
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [kpis, setKpis]                 = useState({ activeDisruptions: 0, idleAssets: 0, criticalShipments: 0, openColdChainAlerts: 0 });
  const [alerts, setAlerts]             = useState<AlertData[]>([]);
  const [newAlertIds, setNewAlertIds]   = useState<Set<string>>(new Set());
  const [recommendations, setRecs]      = useState<RecommendationData[]>([]);
  const [auditEvents, setAudit]         = useState<any[]>([]);
  const [shipments, setShipments]       = useState<any[]>([]);
  const [fleets, setFleets]             = useState<any[]>([]);
  const [disruptions, setDisruptions]   = useState<any[]>([]);
  const [logs, setLogs]                 = useState<SensorLog[]>([]);
  const [newLogIds, setNewLogIds]       = useState<Set<string>>(new Set());
  const [isConnected, setIsConnected]   = useState(false);
  const [isResetting, setIsResetting]   = useState(false);
  // Tour — shown once on first visit, dismissable via localStorage
  const [showTour, setShowTour] = useState(false);

  // Simulation state — which scenario is currently running
  const [activeScenario, setActiveScenario] = useState<string | null>(null); // key of the live disruption
  const [simKey, setSimKey]                 = useState<string | null>(null); // key while pipeline is running
  const [simStep, setSimStep]               = useState(-1);
  const [simLabel, setSimLabel]             = useState("");

  // Map
  const flySeq = useRef(0);
  const [mapFlyTo, setMapFlyTo]         = useState<{ lat: number; lng: number; zoom?: number; seq?: number; fitPts?: [number,number][] } | null>(null);
  const [mapSpotlight, setMapSpotlight] = useState<{ lat: number; lng: number; label: string; type: string } | null>(null);
  const [rerouteShipmentId, setRerouteShipmentId] = useState<string | null>(null);
  const [reroutePath, setReroutePath]   = useState<[number, number][]>([]);
  const [rerouteLabels, setRerouteLabels] = useState<string[]>([]);
  // The ORIGINAL (blocked) route shown in red
  const [blockedPath, setBlockedPath]   = useState<[number, number][]>([]);
  // Fleet dispatch line: from idle fleet position → shipment current location
  const [fleetDispatchLine, setFleetDispatchLine] = useState<{ from: [number,number]; to: [number,number]; assetId: string } | null>(null);
  // Rec metadata for the Before/After map panel
  const [activeRecMeta, setActiveRecMeta] = useState<{
    shipmentId: string; cargo: string; origin: string; destination: string;
    disruption: string;
    costDelta: number; timeDeltaHours: number; riskScore: number; routeLabel: string;
  } | null>(null);

  const CITY_COORDS: Record<string, [number, number]> = {
    "New York": [40.71, -74.01], "Los Angeles": [34.05, -118.24], "Chicago": [41.88, -87.63],
    "Atlanta": [33.75, -84.39],  "Houston": [29.76, -95.37],      "Miami": [25.77, -80.19],
    "Denver": [39.74, -104.98],  "Dallas": [32.78, -96.80],       "Philadelphia": [39.95, -75.16],
    "St. Louis": [38.63, -90.2], "San Diego": [32.72, -117.16],   "Las Vegas": [36.17, -115.14],
    "Orlando": [28.54, -81.38],  "Atlanta Cold Storage": [33.75, -84.45],
    "Shanghai": [31.22, 121.47], "Oakland": [37.80, -122.27],
    "JFK Airport": [40.64, -73.78], "LAX Airport": [33.94, -118.41],
    "San Antonio": [29.42, -98.49], "El Paso": [31.76, -106.49],
    "Albuquerque": [35.08, -106.65], "Phoenix": [33.45, -112.07],
  };

  // ── Scenario definitions ───────────────────────────────────────────────────

  const scenarios = [
    {
      key: "la",      label: "LA Port Strike",  type: "Port Strike", location: "Los Angeles",
      description: "Congestion at LA/Long Beach — affects 2 vaccine shipments",
      // colours per state
      idleClass:    "border-slate-800 bg-slate-900/20 text-slate-500",
      activeClass:  "border-rose-500/60 bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20",
      runningClass: "border-rose-400/80 bg-rose-500/15 text-rose-200 ring-2 ring-rose-400/30",
      dot:  "bg-rose-500",
      text: "text-rose-400",
    },
    {
      key: "chicago", label: "Chicago Blizzard", type: "Blizzard",   location: "Chicago",
      description: "I-90/I-94 corridor blocked — 1 critical shipment held",
      idleClass:    "border-slate-800 bg-slate-900/20 text-slate-500",
      activeClass:  "border-sky-500/60 bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20",
      runningClass: "border-sky-400/80 bg-sky-500/15 text-sky-200 ring-2 ring-sky-400/30",
      dot:  "bg-sky-400",
      text: "text-sky-400",
    },
    {
      key: "miami",   label: "Miami Hurricane",  type: "Hurricane",   location: "Miami",
      description: "Mandatory hold — cold storage at Atlanta staged",
      idleClass:    "border-slate-800 bg-slate-900/20 text-slate-500",
      activeClass:  "border-teal-500/60 bg-teal-500/10 text-teal-300 ring-1 ring-teal-500/20",
      runningClass: "border-teal-400/80 bg-teal-500/15 text-teal-200 ring-2 ring-teal-400/30",
      dot:  "bg-teal-400",
      text: "text-teal-400",
    },
  ] as const;

  // ── Fetch + socket ──────────────────────────────────────────────────────────

  const fetchAll = async () => {
    try {
      const [locRes, cmdRes, auditRes] = await Promise.all([
        fetch("http://127.0.0.1:4000/api/locations"),
        fetch("http://127.0.0.1:4000/api/v1/command-center"),
        fetch("http://127.0.0.1:4000/api/v1/audit"),
      ]);
      const loc   = await locRes.json();
      const cmd   = await cmdRes.json();
      const audit = await auditRes.json();
      setShipments(loc.shipments     || []);
      setFleets(loc.fleets           || []);
      const activeDis = (loc.disruptions || []).filter((d: any) => d.status === "Active" || !d.status);
      setDisruptions(activeDis);
      setKpis(cmd.kpis);
      setAlerts(cmd.alerts           || []);
      setRecs(cmd.recommendations    || []);
      setAudit(audit.events          || []);
      // Never restore a stale active scenario on page load — always start clean.
      // The user must explicitly click a card to activate a scenario.
      setActiveScenario(null);
    } catch (e) { console.error("fetch failed", e); }
  };

  useEffect(() => {
    fetchAll();
    // Show tour on first visit; localStorage key lets user dismiss permanently
    if (typeof window !== "undefined" && !localStorage.getItem("cc_tour_done")) {
      setTimeout(() => setShowTour(true), 800); // slight delay so the page renders first
    }

    const socket = io("http://127.0.0.1:4000");
    socket.on("connect",    () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("temperatureUpdate", (log: SensorLog) => {
      const key = `${log.shipmentId}-${log.timestamp}`;
      setLogs(prev => [log, ...prev].slice(0, 20));
      setNewLogIds(prev => {
        const s = new Set(prev); s.add(key);
        setTimeout(() => setNewLogIds(p => { const n = new Set(p); n.delete(key); return n; }), 2000);
        return s;
      });
    });

    socket.on("telemetry.alert", (a: AlertData) => {
      setAlerts(prev => [a, ...prev]);
      setNewAlertIds(prev => {
        const s = new Set(prev); s.add(a._id);
        setTimeout(() => setNewAlertIds(p => { const n = new Set(p); n.delete(a._id); return n; }), 3000);
        return s;
      });
      setKpis(prev => ({ ...prev, openColdChainAlerts: prev.openColdChainAlerts + 1 }));
    });

    // Backend resolved previous scenario and wiped recs
    socket.on("scenario.reset", () => {
      setRecs([]);
      setDisruptions([]);
      setActiveScenario(null);
      setRerouteShipmentId(null);
      setReroutePath([]);
      setRerouteLabels([]);
      setBlockedPath([]);
      setActiveRecMeta(null);
      setFleetDispatchLine(null);
    });

    socket.on("disruption.updated", (data: any) => {
      setDisruptions([data.disruption]); // always exactly 1 active
      if (data.disruption?.geometry) {
        const r = data.disruption.geometry.radius || 250;
        const z = calcZoomForRadius(r);
        setMapFlyTo({ lat: data.disruption.geometry.lat, lng: data.disruption.geometry.lng, zoom: z, seq: ++flySeq.current });
      }
      setSimStep(s => s < 2 ? 2 : s);
    });

    socket.on("recommendation.created", (rec: RecommendationData) => {
      setRecs(prev => {
        // Replace any existing pending rec for the same shipment
        const without = prev.filter(r => !(r.entityId === rec.entityId && (!r.status || r.status === "Pending")));
        return [rec, ...without];
      });
      setSimStep(SIM_STEPS.length - 1);
      setTimeout(() => { setSimKey(null); setSimStep(-1); }, 2500);
    });

    socket.on("action.completed", (data: any) => {
      setRecs(prev => prev.filter(r => r._id !== data.recommendation._id));
      fetch("http://127.0.0.1:4000/api/v1/audit").then(r => r.json()).then(d => setAudit(d.events || [])).catch(() => {});
      fetch("http://127.0.0.1:4000/api/v1/command-center").then(r => r.json()).then(d => setKpis(d.kpis)).catch(() => {});
    });

    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line

  // ── Actions ────────────────────────────────────────────────────────────────

  const triggerDisruption = async (type: string, location: string, key: string) => {
    if (simKey !== null) return;

    // Instantly clear previous scenario state so Action Center empties immediately
    setRecs([]);
    setDisruptions([]);
    setActiveScenario(key);
    setRerouteShipmentId(null);
    setReroutePath([]);
    setRerouteLabels([]);
    setBlockedPath([]);
    setActiveRecMeta(null);
    setFleetDispatchLine(null);

    setSimKey(key);
    setSimLabel(scenarios.find(s => s.key === key)?.label ?? key);
    setSimStep(0);

    const coords = CITY_COORDS[location];
    if (coords) setMapFlyTo({ lat: coords[0], lng: coords[1], zoom: 9, seq: ++flySeq.current });

    setTimeout(() => setSimStep(s => s < 1 ? 1 : s), 700);
    setTimeout(() => setSimStep(s => s < 2 ? 2 : s), 1400);
    setTimeout(() => setSimStep(s => s < 3 ? 3 : s), 2200);

    await fetch("http://127.0.0.1:4000/api/disruptions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disruptionType: type, location }),
    }).catch(() => {});

    // Safety fallback — if socket never fires within 15s
    setTimeout(() => {
      setSimStep(s => s >= 0 ? SIM_STEPS.length - 1 : s);
      setTimeout(() => { setSimKey(null); setSimStep(-1); }, 3000);
    }, 15000);
  };

  const handleReset = async () => {
    setIsResetting(true);
    // Clear UI immediately — don't wait for fetch
    setRecs([]);
    setDisruptions([]);
    setActiveScenario(null);
    setSimKey(null);
    setSimStep(-1);
    setRerouteShipmentId(null);
    setReroutePath([]);
    setRerouteLabels([]);
    setBlockedPath([]);
    setActiveRecMeta(null);
    setFleetDispatchLine(null);
    await fetch("http://127.0.0.1:4000/api/v1/reset", { method: "POST" }).catch(() => {});
    // Re-fetch to sync KPIs / shipments from DB
    await fetchAll();
    setIsResetting(false);
  };

  // Helper: build the blocked (original) path — full origin → destination so it's always visible
  // Even if the shipment is near the destination, we show the whole planned corridor in red.
  const buildBlockedPath = (ship: any): [number, number][] => {
    if (!ship) return [];
    const originPt = ship.origin ? CITY_COORDS[ship.origin] ?? null : null;
    const destPt   = ship.destination ? CITY_COORDS[ship.destination] ?? null : null;
    if (originPt && destPt) return [originPt, destPt];
    // fallback: current location → destination
    const curPt = ship.currentLocation ? [ship.currentLocation.lat, ship.currentLocation.lng] as [number, number] : null;
    if (curPt && destPt) return [curPt, destPt];
    return [];
  };

  // Helper: build reroute path + labels + recMeta + fleet dispatch line
  const buildRerouteData = (rec: RecommendationData) => {
    const alt      = rec.evidence?.alternateRoute;
    const ship     = shipments.find(f => f.shipmentId === rec.entityId);
    const originName = ship?.origin ?? "";
    const destName   = ship?.destination ?? "";
    if (!alt?.via?.length) return null;

    // Start from the named ORIGIN city (not current location which may be near destination)
    const originPt: [number, number] | null = originName ? CITY_COORDS[originName] ?? null : null;
    const viaPts = (alt.via as string[]).map(v => CITY_COORDS[v]).filter(Boolean) as [number, number][];
    const destPt = destName ? CITY_COORDS[destName] ?? null : null;

    const fullPath: [number, number][] = [
      ...(originPt ? [originPt] : []),
      ...viaPts,
      ...(destPt ? [destPt] : []),
    ];
    // Labels: use the actual city name for origin (not shipment ID)
    const labels = [
      originName || rec.entityId,
      ...(alt.via as string[]),
      ...(destName ? [destName] : []),
    ];

    const disruption = disruptions[0];
    const disruptionLabel = disruption?.title ?? disruption?.type ?? "Active Disruption";

    const meta = {
      shipmentId:    rec.entityId,
      cargo:         ship?.cargoType ?? "Cargo",
      origin:        originName,
      destination:   destName,
      disruption:    disruptionLabel,
      costDelta:     alt.costDelta,
      timeDeltaHours: alt.timeDeltaHours,
      riskScore:     alt.riskScore,
      routeLabel:    alt.route,
    };

    // Fleet dispatch line: idle truck → shipment's current position
    const fleetMatch = rec.evidence?.fleetMatch;
    let fleetLine: { from: [number,number]; to: [number,number]; assetId: string } | null = null;
    if (fleetMatch?.fleet) {
      const fleetObj = fleets.find(f => f.assetId === fleetMatch.fleet.assetId);
      if (fleetObj?.currentLocation && ship?.currentLocation) {
        fleetLine = {
          from: [fleetObj.currentLocation.lat, fleetObj.currentLocation.lng],
          to:   [ship.currentLocation.lat, ship.currentLocation.lng],
          assetId: fleetMatch.fleet.assetId,
        };
      }
    }

    return { fullPath, labels, blockedPath: buildBlockedPath(ship), meta, fleetLine };
  };

  const approveRec = async (rec: RecommendationData) => {
    try {
      await fetch(`http://127.0.0.1:4000/api/v1/recommendations/${rec._id}/approve`, { method: "POST" });
      const data = buildRerouteData(rec);
      if (data && data.fullPath.length >= 2) {
        setRerouteShipmentId(rec.entityId);
        setReroutePath(data.fullPath);
        setRerouteLabels(data.labels);
        setBlockedPath(data.blockedPath);
        setActiveRecMeta(data.meta);
        if (data.fleetLine) setFleetDispatchLine(data.fleetLine);
        const allPts = [...data.fullPath, ...data.blockedPath];
        setMapFlyTo({ lat: allPts[0][0], lng: allPts[0][1], zoom: 0, seq: ++flySeq.current, fitPts: allPts });
      }
      // spotlight the fleet truck on the map too
      const fleetMatch = rec.evidence?.fleetMatch;
      if (fleetMatch?.fleet) {
        const fleetObj = fleets.find(f => f.assetId === fleetMatch.fleet.assetId);
        if (fleetObj?.currentLocation) {
          const { lat, lng } = fleetObj.currentLocation;
          setMapSpotlight({ lat, lng, label: fleetMatch.fleet.assetId, type: "fleet" });
        }
      }
    } catch (e) { console.error("approve failed", e); }
  };

  const rejectRec = async (id: string) => {
    await fetch(`http://127.0.0.1:4000/api/v1/recommendations/${id}/reject`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Manually rejected by operator" }),
    }).catch(() => {});
    setRecs(prev => prev.filter(r => r._id !== id));
  };

  const pendingRecs = recommendations.filter(r => !r.status || r.status === "Pending");

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#060b14] text-slate-100 font-sans">

      {/* ══ NAV ════════════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#060b14]/92 backdrop-blur-lg">
        <div className="max-w-[1600px] mx-auto px-5 flex items-center justify-between gap-4" style={{ height: 52 }}>
          <div className="flex items-center gap-2.5">
            {/* Logo: snowflake-in-network — cold-chain supply chain icon */}
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20"
              style={{ background: "linear-gradient(135deg,#0ea5e9 0%,#2563eb 100%)" }}>
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {/* Snowflake arms */}
                <line x1="12" y1="2"  x2="12" y2="22"/>
                <line x1="2"  y1="12" x2="22" y2="12"/>
                <line x1="5"  y1="5"  x2="19" y2="19"/>
                <line x1="19" y1="5"  x2="5"  y2="19"/>
                {/* Centre node */}
                <circle cx="12" cy="12" r="2.2" fill="white" stroke="none"/>
                {/* Route dots at arm tips */}
                <circle cx="12" cy="3.5" r="1.1" fill="white" stroke="none"/>
                <circle cx="12" cy="20.5" r="1.1" fill="white" stroke="none"/>
                <circle cx="3.5" cy="12" r="1.1" fill="white" stroke="none"/>
                <circle cx="20.5" cy="12" r="1.1" fill="white" stroke="none"/>
              </svg>
            </div>
            <div className="flex flex-col leading-none gap-0.5">
              <span className="text-[13px] font-bold text-white tracking-tight">
                SupplyChain<span className="text-cyan-400">AI</span>
                <span className="ml-1 text-[10px] font-semibold text-slate-400">Copilot</span>
              </span>
              <span className="hidden md:inline text-[8px] font-bold uppercase tracking-[0.18em] text-slate-600">
                Cold‑Chain Command Center
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LiveClock />
            <div className="h-4 border-l border-slate-800" />
            {/* Tour launcher button */}
            <button
              onClick={() => setShowTour(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-blue-400 border border-slate-800 hover:border-blue-800/60 rounded-lg transition-colors"
              title="Take a guided tour"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
              </svg>
              Tour
            </button>
            <div className="h-4 border-l border-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              <span className={`text-[11px] font-semibold ${isConnected ? "text-emerald-400" : "text-red-400"}`}>
                {isConnected ? "Live" : "Offline"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ══ MAIN ════════════════════════════════════════════════════════════════ */}
      <main className="max-w-[1600px] mx-auto px-5 py-6 space-y-6">

        {/* ── KPI row ─────────────────────────────────────────────────────────── */}
        <div data-tour="kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Active Disruptions",  value: disruptions.filter(d => d.status === "Active" || !d.status).length, color: "text-amber-400" },
            { label: "Idle Fleet Assets",   value: kpis.idleAssets,          color: "text-emerald-400" },
            { label: "Critical Shipments",  value: kpis.criticalShipments,   color: "text-red-400" },
            { label: "Cold Chain Alerts",   value: kpis.openColdChainAlerts, color: "text-blue-400" },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-slate-800/60 bg-slate-900/30 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">{k.label}</div>
              <div className={`text-2xl font-black tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* ── Scenario selector ────────────────────────────────────────────────
             3 cards, only 1 can be "active" at a time.
             States:
               idle     = grey, all equal, all clickable
               running  = the clicked one lights up with spinner; others dim out
               active   = the current live disruption, coloured, pulsing dot
               others   = while one is active, other two are dim/unclickable
        ──────────────────────────────────────────────────────────────────────── */}
        <div data-tour="scenarios">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Simulate Scenario</span>
              <span className="text-[10px] text-slate-700">— one active at a time</span>
            </div>
            {/* Reset button — only shown when something is active */}
            {(activeScenario || pendingRecs.length > 0) && (
              <button
                onClick={handleReset}
                disabled={isResetting || simKey !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-white border border-slate-800 hover:border-slate-600 rounded-lg transition-colors disabled:opacity-40"
              >
                {isResetting
                  ? <span className="w-2.5 h-2.5 border border-slate-600 border-t-slate-300 rounded-full animate-spin" />
                  : <span>↺</span>}
                Reset
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {scenarios.map(s => {
              const isRunning  = simKey === s.key;
              const isActive   = activeScenario === s.key && simKey === null;
              // While a simulation is in-flight, only block the other 2 cards (not the running one)
              const isBlocked  = simKey !== null && simKey !== s.key;
              // Visually dim cards that aren't the current live scenario (but still hoverable)
              const isDimmed   = !isRunning && !isActive && activeScenario !== null;

              const cardClass  = isRunning ? s.runningClass
                               : isActive  ? s.activeClass
                               : s.idleClass;

              return (
                <button
                  key={s.key}
                  onClick={() => !isBlocked ? triggerDisruption(s.type, s.location, s.key) : undefined}
                  className={`
                    relative text-left px-4 py-4 rounded-xl border transition-all duration-300
                    ${cardClass}
                    ${isBlocked ? "opacity-30 saturate-0 cursor-wait" : "cursor-pointer"}
                    ${isDimmed && !isBlocked ? "opacity-50 hover:opacity-100" : ""}
                    ${!isBlocked && !isActive ? "hover:border-slate-500" : ""}
                  `}
                >
                  {/* State indicator top-right */}
                  <div className="absolute top-3 right-3">
                    {isRunning && (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin opacity-70" />
                    )}
                    {isActive && (
                      <span className={`text-[9px] font-bold uppercase tracking-widest ${s.text} flex items-center gap-1`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot} animate-pulse`} />
                        LIVE
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  <div className={`text-[13px] font-bold mb-1 pr-12 ${isRunning || isActive ? "" : "text-slate-400"}`}>
                    {s.label}
                  </div>

                  {/* Description OR inline pipeline steps while running */}
                  {isRunning ? (
                    <div className="mt-2 space-y-1">
                      {SIM_STEPS.map((stepLabel, idx) => {
                        const done    = simStep > idx;
                        const current = simStep === idx;
                        return (
                          <div key={idx} className={`flex items-center gap-2 text-[10px] transition-opacity duration-300 ${idx > simStep ? "opacity-25" : "opacity-100"}`}>
                            <span className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                              {done
                                ? <span className="text-emerald-400 text-[11px] font-bold">✓</span>
                                : current
                                ? <span className="w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin block" />
                                : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-30 block" />}
                            </span>
                            <span className={done ? "text-emerald-400/70 line-through" : current ? "text-current font-semibold" : "text-slate-600"}>
                              {stepLabel}
                            </span>
                          </div>
                        );
                      })}
                      {/* Progress bar */}
                      <div className="mt-2 h-px bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${((simStep + 1) / SIM_STEPS.length) * 100}%`, background: "currentColor", opacity: 0.5 }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-600 leading-snug">{s.description}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Map + AI Action Center ───────────────────────────────────────────
             8 cols map, 4 cols action center
        ──────────────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">

          {/* Map */}
          <div data-tour="map" className="xl:col-span-8 rounded-xl overflow-hidden border border-slate-800/60">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/60 bg-slate-900/30">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Live Fleet & Disruption Map</span>
              <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-widest text-slate-700">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Shipment</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Fleet</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/60 border border-red-500" />Disruption</span>
              </div>
            </div>
            <LiveMap
              disruptions={disruptions}
              shipments={shipments}
              fleets={fleets}
              rerouteShipmentId={rerouteShipmentId}
              reroutePath={reroutePath}
              rerouteLabels={rerouteLabels}
              blockedPath={blockedPath}
              activeRecMeta={activeRecMeta}
              fleetDispatchLine={fleetDispatchLine}
              flyTo={mapFlyTo}
              spotlight={mapSpotlight}
              focusShipmentIds={
                activeScenario === "la"      ? ["SHIP-MVP-101", "SHIP-MVP-102", "SHIP-MVP-106"] :
                activeScenario === "chicago" ? ["SHIP-MVP-103"] :
                activeScenario === "miami"   ? ["SHIP-MVP-104"] :
                undefined
              }
            />
          </div>

          {/* AI Action Center */}
          <div data-tour="action-center" className="xl:col-span-4 flex flex-col">
            <SectionHeader title="AI Action Center" count={pendingRecs.length} />

            {pendingRecs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-800 bg-slate-900/20 text-slate-700 text-[11px] min-h-[220px]">
                <svg className="w-7 h-7 opacity-25" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <div className="text-center">
                  <div className="text-slate-600 font-semibold mb-1">No pending actions</div>
                  <div className="text-slate-700 text-[10px]">Trigger a scenario above<br/>to generate AI recommendations</div>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 overflow-y-auto max-h-[540px] pr-0.5">
                {pendingRecs.map((rec) => (
                  <RecCard
                    key={rec._id}
                    rec={rec}
                    shipment={shipments.find(s => s.shipmentId === rec.entityId)}
                    disruption={disruptions[0] ?? null}
                    onPreview={() => {
                      const data = buildRerouteData(rec);
                      if (data && data.fullPath.length >= 2) {
                        setRerouteShipmentId(rec.entityId);
                        setReroutePath(data.fullPath);
                        setRerouteLabels(data.labels);
                        setBlockedPath(data.blockedPath);
                        setActiveRecMeta(data.meta);
                        if (data.fleetLine) setFleetDispatchLine(data.fleetLine);
                        const allPts = [...data.fullPath, ...data.blockedPath];
                        setMapFlyTo({ lat: allPts[0][0], lng: allPts[0][1], zoom: 0, seq: ++flySeq.current, fitPts: allPts });
                      } else if (disruptions[0]?.geometry) {
                        const g = disruptions[0].geometry;
                        setMapFlyTo({ lat: g.lat, lng: g.lng, zoom: 7, seq: ++flySeq.current });
                      }
                    }}
                    onReject={() => rejectRec(rec._id)}
                    onApprove={() => approveRec(rec)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Incidents + sensor feed ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div data-tour="incidents">
            {/* Show only alerts relevant to the active scenario's affected shipments.
                When no scenario is active, show the most recent Cold-Chain alerts only. */}
            {(() => {
              // Shipment IDs affected by the active scenario
              const scenarioShipments: Record<string, string[]> = {
                la:      ["SHIP-MVP-101", "SHIP-MVP-102", "SHIP-MVP-106"],
                chicago: ["SHIP-MVP-103"],
                miami:   ["SHIP-MVP-104"],
              };
              const activeIds = activeScenario ? (scenarioShipments[activeScenario] ?? []) : [];
              const filteredAlerts = activeScenario
                ? alerts.filter(a =>
                    activeIds.some(id => a.title?.includes(id) || a.message?.includes(id)) ||
                    a.severity === "Critical"
                  )
                : alerts.filter(a => a.entityType === "Excursion" || a.severity === "Critical").slice(0, 8);
              return (
                <>
                  <SectionHeader
                    title={activeScenario ? `Active Incidents — ${scenarios.find(s => s.key === activeScenario)?.label ?? ""}` : "Active Incidents"}
                    count={filteredAlerts.length}
                    live
                  />
                  {filteredAlerts.length === 0
                    ? <div className="flex items-center justify-center h-24 rounded-xl border border-dashed border-slate-800 text-slate-700 text-xs">
                        {activeScenario ? "No incidents for this scenario yet — pipeline running…" : "No active incidents"}
                      </div>
                    : <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                        {filteredAlerts.slice(0, 8).map((alert, i) => (
                          <AlertRow key={alert._id || i} alert={alert} isNew={newAlertIds.has(alert._id)} />
                        ))}
                      </div>
                  }
                </>
              );
            })()}
          </div>
          <div data-tour="sensor-feed">
            <SectionHeader title="Live Sensor Feed" live />
            <div className="space-y-1 max-h-[280px] overflow-y-auto">
              {logs.length === 0
                ? <div className="flex items-center justify-center gap-2 h-24 text-slate-700 text-[11px]">
                    <div className="w-3.5 h-3.5 border border-slate-800 border-t-blue-700 rounded-full animate-spin" />
                    Awaiting telemetry…
                  </div>
                : logs.map(log => {
                    const key = `${log.shipmentId}-${log.timestamp}`;
                    return <SensorRow key={key} log={log} isNew={newLogIds.has(key)} />;
                  })
              }
            </div>
          </div>
        </div>

        {/* ── Temperature analytics ──────────────────────────────────────────── */}
        <HistoricalAnalytics />

        {/* ── Audit trail ──────────────────────────────────────────────────────── */}
        <div data-tour="audit" className="pb-24">
          <SectionHeader title="Audit Trail" count={auditEvents.length} />
          {auditEvents.length === 0
            ? <div className="flex items-center justify-center h-14 rounded-xl border border-dashed border-slate-800 text-slate-700 text-[11px]">
                Approve or reject a recommendation to generate records
              </div>
            : <div className="space-y-1.5">
                {auditEvents.slice(0, 10).map((evt: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-800/40 bg-slate-900/20 text-[11px]">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
                        evt.eventType === "ApproveRecommendation" ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" :
                        evt.eventType === "RejectRecommendation"  ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/20" :
                        "bg-slate-800 text-slate-500"
                      }`}>{evt.eventType}</span>
                      <span className="text-slate-500">{evt.entityType}</span>
                      <span className="text-slate-700 font-mono">{String(evt.entityId).slice(-8)}</span>
                    </div>
                    <span className="text-slate-700 tabular-nums">{new Date(evt.createdAt).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
          }
        </div>
      </main>

      <SimToast step={simStep} label={simLabel} />
      <ChatCopilot />
      {showTour && (
        <TourOverlay onDone={() => {
          setShowTour(false);
          if (typeof window !== "undefined") localStorage.setItem("cc_tour_done", "1");
        }} />
      )}
    </div>
  );
}
