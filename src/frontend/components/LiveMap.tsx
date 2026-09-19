"use client";
import React, { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ─── Coordinate safety ────────────────────────────────────────────────────────
// Reject [0,0] (null island) and NaN.
// We now support worldwide coords (Pacific ocean vessel routes).
function validCoord(pt: any): pt is [number, number] {
  if (!Array.isArray(pt) || pt.length < 2) return false;
  const [lat, lng] = pt;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;  // null island
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function toLatLng(lat: any, lng: any): [number, number] | null {
  const pt: [number, number] = [Number(lat), Number(lng)];
  return validCoord(pt) ? pt : null;
}

// ─── Icon factory ─────────────────────────────────────────────────────────────

const makeIcon = (color: string, svgInner: string, pulse = false) =>
  L.divIcon({
    className: "",
    html: `<div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;">
      ${pulse ? `
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};
          animation:iconSonar 2s ease-out infinite;opacity:0;"></div>
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};
          animation:iconSonar 2s ease-out 0.7s infinite;opacity:0;"></div>
      ` : ""}
      <div style="
        background:${color};width:28px;height:28px;border-radius:50%;
        border:2px solid rgba(255,255,255,0.9);
        box-shadow:0 0 0 3px ${color}55,0 4px 14px rgba(0,0,0,0.6);
        display:flex;align-items:center;justify-content:center;
        position:relative;z-index:1;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          ${svgInner}
        </svg>
      </div>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

const makeWaypointIcon = (label: string, color: string) =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
      <div style="width:10px;height:10px;border-radius:50%;background:${color};
        border:2px solid rgba(255,255,255,0.8);box-shadow:0 0 0 2px ${color}66;"></div>
      <div style="
        margin-top:3px;background:rgba(6,11,20,0.92);border:1px solid ${color}66;
        color:${color};font-size:9px;font-weight:700;white-space:nowrap;
        padding:1px 5px;border-radius:3px;letter-spacing:0.04em;
        font-family:system-ui,sans-serif;text-transform:uppercase;">
        ${label}
      </div>
    </div>`,
    iconSize: [80, 28],
    iconAnchor: [40, 5],
  });

// Road freight truck SVG
const TRUCK_SVG  = `<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`;
// Ocean vessel / container ship SVG
const VESSEL_SVG = `<path d="M2 20a2 2 0 002 2h16a2 2 0 002-2"/><path d="M5 20V10h14v10"/><path d="M8 10V6l4-4 4 4v4"/><line x1="12" y1="6" x2="12" y2="10"/>`;
// Airplane SVG
const PLANE_SVG  = `<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5S18 2 16.5 3.5L13 7 4.8 5.2A1 1 0 004 6l3 4.5-4 4V16l4-1 4 3h2l1-5.2z"/>`;
const ALERT_SVG  = `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`;

// Normal (blue) and risk (red/pulsing) versions for each mode
const roadIcon       = makeIcon("#3b82f6",  TRUCK_SVG);
const roadRiskIcon   = makeIcon("#ef4444",  TRUCK_SVG, true);
const vesselIcon     = makeIcon("#38bdf8",  VESSEL_SVG);       // sky blue
const vesselRiskIcon = makeIcon("#f97316",  VESSEL_SVG, true); // orange pulsing
const planeIcon      = makeIcon("#a78bfa",  PLANE_SVG);        // purple
const truckIcon      = makeIcon("#22c55e",  TRUCK_SVG);        // idle fleet — green
const alertIcon      = makeIcon("#ef4444",  ALERT_SVG, true);

// Pick icon by route leg mode and risk score
/**
 * Pin colour answers "how long has this cargo got", not a generic risk score.
 * Falls back to riskScore when no life clock is available.
 */
function getShipmentIcon(ship: any, clock?: { state: string }): L.DivIcon {
  const mode = ship.transportMode ?? ship.routeLegs?.[0]?.mode ?? ship.mode ?? "Road";
  const urgent = clock
    ? clock.state === "red" || clock.state === "black"
    : (ship.riskScore ?? 0) >= 50;
  if (mode === "Sea" || mode === "Ocean") return urgent ? vesselRiskIcon : vesselIcon;
  if (mode === "Air") return planeIcon;
  return urgent ? roadRiskIcon : roadIcon;
}

// ─── Injected CSS ─────────────────────────────────────────────────────────────

const MAP_STYLES = `
@keyframes iconSonar {
  0%   { transform:scale(0.8); opacity:0.6; }
  80%  { transform:scale(2.8); opacity:0; }
  100% { transform:scale(2.8); opacity:0; }
}
/* Tiles are inverted for the dark theme only. --map-filter is defined per
   theme in globals.css, so light mode shows the map as drawn instead of as a
   negative. */
.leaflet-tile { filter: var(--map-filter); }
.leaflet-container { background: var(--surface-raised) !important; }
.leaflet-attribution-flag { display:none !important; }
.leaflet-control-attribution {
  background: var(--surface) !important; color: var(--text-subtle) !important;
  font-size:8px !important; border-radius:4px !important; padding:2px 5px !important;
}
.cc-popup .leaflet-popup-content-wrapper {
  background: var(--surface); border:1px solid var(--border); border-radius:12px;
  color: var(--text); font-size:12px; padding:0;
  box-shadow:0 16px 48px rgba(0,0,0,0.8); min-width:170px;
}
.cc-popup .leaflet-popup-content { margin:0; }
.cc-popup .leaflet-popup-tip-container { margin-top:-1px; }
.cc-popup .leaflet-popup-tip { background: var(--surface); }
.cc-popup .leaflet-popup-close-button {
  color:#475569 !important; font-size:16px !important;
  top:8px !important; right:10px !important; padding:0 !important;
}
@keyframes ringBreath { 0%,100% { opacity:0.65; } 50% { opacity:0.1; } }
.disruption-outer-ring { animation:ringBreath 2.6s ease-in-out infinite; }
@keyframes dashMarch { to { stroke-dashoffset:-32; } }
.reroute-march { stroke-dasharray:10 6; animation:dashMarch 0.85s linear infinite; }
@keyframes glowFadeIn { from { opacity:0; } to { opacity:0.18; } }
.reroute-glow { animation:glowFadeIn 0.6s ease forwards; }
@keyframes sonarExpand1 { 0% { stroke-width:3;opacity:1;r:8px; } 100% { stroke-width:0;opacity:0;r:180px; } }
@keyframes sonarExpand2 { 0% { stroke-width:2;opacity:0.7;r:8px; } 100% { stroke-width:0;opacity:0;r:120px; } }
.sonar1 { animation:sonarExpand1 1.4s cubic-bezier(0.2,0.8,0.3,1) forwards; }
.sonar2 { animation:sonarExpand2 1.4s cubic-bezier(0.2,0.8,0.3,1) 0.35s forwards; }
`;

// ─── Inner-map hooks ──────────────────────────────────────────────────────────

function FitBoundsOnLoad({ shipments }: { shipments: any[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !shipments.length) return;
    const pts = shipments
      .map(s => toLatLng(s.currentLocation?.lat, s.currentLocation?.lng))
      .filter(Boolean) as [number,number][];
    if (pts.length < 2) return;
    done.current = true;
    map.fitBounds(L.latLngBounds(pts).pad(0.4), { animate: true, duration: 1.5 });
  }, [shipments.length]); // eslint-disable-line
  return null;
}

function FlyToController({ target }: { target: { lat:number; lng:number; zoom:number; seq:number; fitPts?: [number,number][] } | null }) {
  const map = useMap();
  const lastSeq = useRef(-1);
  useEffect(() => {
    if (!target) return;
    if (target.seq === lastSeq.current) return;
    lastSeq.current = target.seq;
    if (target.fitPts && target.fitPts.length >= 2) {
      // Fit the full set of comparison points with generous padding
      const bounds = L.latLngBounds(target.fitPts.map(p => L.latLng(p[0], p[1])));
      map.flyToBounds(bounds.pad(0.22), { animate: true, duration: 1.8, maxZoom: 7 });
    } else {
      map.flyTo([target.lat, target.lng], target.zoom || 5, { animate: true, duration: 1.6 });
    }
  }, [target]); // eslint-disable-line
  return null;
}

function SonarSpotlight({ spotlight }: {
  spotlight: { lat:number; lng:number; label:string; type:string } | null
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  useEffect(() => {
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (!spotlight) return;
    const color = spotlight.type === "fleet" ? "#22c55e" : spotlight.type === "disruption" ? "#ef4444" : "#3b82f6";
    const icon = L.divIcon({
      className: "",
      html: `<div style="position:relative;width:0;height:0;overflow:visible;">
        <svg width="400" height="400" viewBox="-200 -200 400 400"
          style="position:absolute;transform:translate(-200px,-200px);pointer-events:none;overflow:visible;">
          <circle cx="0" cy="0" r="8" fill="none" stroke="${color}" class="sonar1"/>
          <circle cx="0" cy="0" r="8" fill="none" stroke="${color}" class="sonar2"/>
          <circle cx="0" cy="0" r="6" fill="${color}" fill-opacity="0.25"/>
          <circle cx="0" cy="0" r="3" fill="${color}"/>
        </svg>
        <div style="position:absolute;left:8px;top:-22px;background:${color}22;border:1px solid ${color}88;
          color:${color};font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;
          white-space:nowrap;letter-spacing:0.08em;text-transform:uppercase;
          font-family:system-ui,sans-serif;">${spotlight.label}</div>
      </div>`,
      iconSize: [0, 0], iconAnchor: [0, 0],
    });
    const m = L.marker([spotlight.lat, spotlight.lng], { icon, interactive: false, zIndexOffset: 2000 });
    m.addTo(map);
    markerRef.current = m;
    const t = setTimeout(() => { markerRef.current?.remove(); markerRef.current = null; }, 7000);
    return () => { clearTimeout(t); markerRef.current?.remove(); markerRef.current = null; };
  }, [spotlight]); // eslint-disable-line
  return null;
}

// ─── Popup helpers ────────────────────────────────────────────────────────────

function ShipmentPopup({ s, clock }: { s: any; clock?: LifeClockLite }) {
  // The life clock leads. Risk score is kept underneath as supporting detail.
  const CLOCK_COL: Record<string, string> = {
    green: "#34d399", amber: "#fbbf24", red: "#f87171", black: "#b91c1c",
  };
  const rs = s.riskScore ?? 0;
  const col = clock
    ? CLOCK_COL[clock.state]
    : rs >= 75 ? "#f87171" : rs >= 50 ? "#fb923c" : rs >= 25 ? "#fbbf24" : "#34d399";
  const lbl = clock
    ? `${clock.lifeClockH.toFixed(1)}H LEFT`
    : rs >= 75 ? "CRITICAL" : rs >= 50 ? "HIGH" : rs >= 25 ? "WATCH" : "NORMAL";
  return (
    <div style={{ padding:"13px 15px", minWidth:200, fontFamily:"system-ui,sans-serif" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <span style={{ fontWeight:800, color:"#f1f5f9", fontSize:12 }}>{s.shipmentId}</span>
        <span style={{ background:`${col}18`, color:col, border:`1px solid ${col}55`,
          borderRadius:5, fontSize:9, fontWeight:800, padding:"2px 7px", letterSpacing:"0.1em" }}>{lbl}</span>
      </div>
      {clock && (
        <div style={{ marginBottom:9, padding:"7px 9px", borderRadius:6,
          background:`${col}12`, border:`1px solid ${col}40` }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#94a3b8" }}>
            <span>Until late</span>
            <span style={{ fontWeight:700, color: clock.bindingConstraint === "schedule" ? col : "#cbd5e1" }}>
              {clock.scheduleMarginH.toFixed(1)} h{clock.bindingConstraint === "schedule" ? "  ◀ binding" : ""}
            </span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#94a3b8", marginTop:3 }}>
            <span>Until spoiled</span>
            <span style={{ fontWeight:700, color: clock.bindingConstraint === "stability" ? col : "#cbd5e1" }}>
              {clock.stabilityMarginH.toFixed(1)} h{clock.bindingConstraint === "stability" ? "  ◀ binding" : ""}
            </span>
          </div>
          {clock.usdAtRisk > 0 && (
            <div style={{ marginTop:5, paddingTop:5, borderTop:"1px solid #1e293b", fontSize:10, color:"#94a3b8" }}>
              ${Math.round(clock.usdAtRisk).toLocaleString()} at risk
              {clock.dosesAtRisk > 0 && ` · ${clock.dosesAtRisk.toLocaleString()} doses`}
            </div>
          )}
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", rowGap:5, columnGap:14, fontSize:11 }}>
        <span style={{ color:"#475569" }}>Risk</span>
        <span style={{ color:col, fontWeight:800 }}>{rs}/100</span>
        {s.origin      && <><span style={{color:"#475569"}}>From</span><span style={{color:"#94a3b8"}}>{s.origin}</span></>}
        {s.destination && <><span style={{color:"#475569"}}>To</span>  <span style={{color:"#94a3b8"}}>{s.destination}</span></>}
        {s.carrier     && <><span style={{color:"#475569"}}>Carrier</span><span style={{color:"#94a3b8"}}>{s.carrier}</span></>}
        {s.priority    && <><span style={{color:"#475569"}}>Priority</span><span style={{color:"#94a3b8"}}>{s.priority}</span></>}
        {s.cargoType   && <><span style={{color:"#475569"}}>Cargo</span><span style={{color:"#94a3b8"}}>{s.cargoType}</span></>}
      </div>
      {s.riskDrivers?.length > 0 && (
        <div style={{ marginTop:9, borderTop:"1px solid #1e293b", paddingTop:9 }}>
          {s.riskDrivers.slice(0,2).map((d:string,i:number) => (
            <div key={i} style={{ color:"#f87171", fontSize:10, marginBottom:3, display:"flex", gap:5 }}>
              <span>▲</span><span>{d}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FleetPopup({ f }: { f: any }) {
  return (
    <div style={{ padding:"13px 15px", minWidth:175, fontFamily:"system-ui,sans-serif" }}>
      <div style={{ fontWeight:800, color:"#f1f5f9", fontSize:12, marginBottom:2 }}>{f.assetId}</div>
      <div style={{ color:"#34d399", fontSize:9, fontWeight:800, letterSpacing:"0.12em", marginBottom:9 }}>● IDLE · AVAILABLE</div>
      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", rowGap:5, columnGap:14, fontSize:11 }}>
        {f.locationName && <><span style={{color:"#475569"}}>Location</span><span style={{color:"#94a3b8"}}>{f.locationName}</span></>}
        {f.capacityWeight && <><span style={{color:"#475569"}}>Capacity</span><span style={{color:"#94a3b8"}}>{(f.capacityWeight/1000).toFixed(0)}t</span></>}
      </div>
    </div>
  );
}

function DisruptionPopup({ d }: { d: any }) {
  return (
    <div style={{ padding:"13px 15px", minWidth:195, fontFamily:"system-ui,sans-serif" }}>
      <div style={{ color:"#f87171", fontWeight:800, fontSize:11, letterSpacing:"0.06em", marginBottom:4 }}>▲ ACTIVE DISRUPTION</div>
      <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:13, marginBottom:9, lineHeight:1.3 }}>{d.title}</div>
      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", rowGap:5, columnGap:14, fontSize:11 }}>
        {d.type     && <><span style={{color:"#475569"}}>Type</span><span style={{color:"#fca5a5"}}>{d.type}</span></>}
        {d.severity && <><span style={{color:"#475569"}}>Severity</span><span style={{color:"#fca5a5"}}>{d.severity}</span></>}
        {d.geometry?.locationName && <><span style={{color:"#475569"}}>Zone</span><span style={{color:"#94a3b8"}}>{d.geometry.locationName}</span></>}
      </div>
      <div style={{ marginTop:9, color:"#475569", fontSize:10, borderTop:"1px solid #1e293b", paddingTop:7 }}>
        Shipments passing through this zone are impacted
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RerouteWaypoint {
  pos: [number, number];
  label: string;
  isEndpoint?: boolean;
}

interface RecMeta {
  shipmentId: string;
  cargo: string;
  origin: string;
  destination: string;
  disruption: string;
  costDelta: number;
  timeDeltaHours: number;
  riskScore: number;
  routeLabel: string;
}

interface LifeClockLite {
  lifeClockH: number;
  scheduleMarginH: number;
  stabilityMarginH: number;
  state: "green" | "amber" | "red" | "black";
  bindingConstraint: string;
  usdAtRisk: number;
  dosesAtRisk: number;
  severity: string;
}

interface LiveMapProps {
  /** Life clocks keyed by shipmentId — colours the pins by remaining cargo life. */
  lifeClocks?: Record<string, LifeClockLite>;
  disruptions: any[];
  shipments: any[];
  fleets: any[];
  rerouteShipmentId?: string | null;
  reroutePath?: [number, number][];
  rerouteLabels?: string[];
  blockedPath?: [number, number][];
  activeRecMeta?: RecMeta | null;
  fleetDispatchLine?: { from: [number,number]; to: [number,number]; assetId: string } | null;
  flyTo?: { lat:number; lng:number; zoom?:number; seq?:number; fitPts?: [number,number][] } | null;
  spotlight?: { lat:number; lng:number; label:string; type:string } | null;
  /** IDs of shipments affected by the active scenario — used for focus mode */
  focusShipmentIds?: string[];
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LiveMap({
  lifeClocks,
  disruptions, shipments, fleets,
  rerouteShipmentId, reroutePath, rerouteLabels,
  blockedPath, activeRecMeta, fleetDispatchLine,
  flyTo, spotlight, focusShipmentIds,
}: LiveMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const center: [number, number] = [38.5, -96.5];

  // ── Focus / noise reduction ──────────────────────────────────────────────
  // showComparison  → "See on Map" was clicked: highlight ONE shipment only
  // focusShipmentIds → scenario active: highlight affected shipments, dim rest
  // neither          → idle state: show everything normally

  const fitAll = () => {
    if (!mapRef.current) return;
    const pts = shipments
      .map(s => toLatLng(s.currentLocation?.lat, s.currentLocation?.lng))
      .filter(Boolean) as [number,number][];
    if (!pts.length) return;
    if (pts.length === 1) { mapRef.current.flyTo(pts[0], 7, { animate:true, duration:1.2 }); return; }
    mapRef.current.flyToBounds(L.latLngBounds(pts).pad(0.35), { animate:true, duration:1.4 });
  };

  const fitDisruptions = () => {
    if (!mapRef.current) return;
    const pts = disruptions
      .filter(d => d.geometry)
      .map(d => toLatLng(d.geometry.lat, d.geometry.lng))
      .filter(Boolean) as [number,number][];
    if (!pts.length) return;
    if (pts.length === 1) { mapRef.current.flyTo(pts[0], 7, { animate:true, duration:1.2 }); return; }
    mapRef.current.flyToBounds(L.latLngBounds(pts).pad(0.5), { animate:true, duration:1.4 });
  };

  const flyTarget = flyTo
    ? { lat: flyTo.lat, lng: flyTo.lng, zoom: flyTo.zoom ?? 5, seq: flyTo.seq ?? 0, fitPts: flyTo.fitPts }
    : null;

  // Build safe waypoints for the reroute path with labels
  const rerouteWaypoints: RerouteWaypoint[] = (reroutePath ?? [])
    .map((pt, i) => {
      if (!validCoord(pt)) return null;
      const label = rerouteLabels?.[i] ?? (i === 0 ? "Origin" : i === (reroutePath!.length - 1) ? "Dest" : `WP${i}`);
      return { pos: pt, label, isEndpoint: i === 0 || i === (reroutePath!.length - 1) };
    })
    .filter(Boolean) as RerouteWaypoint[];

  const safeReroutePath  = rerouteWaypoints.map(w => w.pos);
  const safeBlockedPath  = (blockedPath ?? []).filter(validCoord);
  const showComparison   = !!(rerouteShipmentId && safeReroutePath.length >= 2);

  // Which shipment IDs should be fully visible vs dimmed/hidden
  const focusSet = focusShipmentIds && focusShipmentIds.length > 0
    ? new Set(focusShipmentIds) : null;

  // Helper: should this shipment be shown at full opacity?
  const isShipFocused = (id: string) => {
    if (showComparison) return id === rerouteShipmentId;  // comparison: only the rerouted one
    if (focusSet)       return focusSet.has(id);          // scenario active: only affected ones
    return true;                                          // idle: everything
  };

  // Opacity values
  const DIM_OPACITY  = 0.08;  // almost invisible background noise
  const FULL_OPACITY = 1.0;

  return (
    <div className="w-full h-[600px] relative z-0">
      <style>{MAP_STYLES}</style>

      <MapContainer
        center={center}
        zoom={4}
        style={{ height:"100%", width:"100%", background:"#060b14" }}
        zoomControl={false}
        ref={mapRef as any}
      >
        <FitBoundsOnLoad shipments={shipments} />
        <FlyToController target={flyTarget} />
        <SonarSpotlight spotlight={spotlight ?? null} />

        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />

        {/* ── Planned route lines ───────────────────────────────────────────
            In comparison mode: hide ALL background route lines (too noisy).
            In scenario mode:   show only affected shipments' lines.
            Idle:               show all at low opacity.
        ─────────────────────────────────────────────────────────────────── */}
        {!showComparison && shipments.map((ship, i) => {
          const focused = isShipFocused(ship.shipmentId);
          if (!focused) return null; // completely hide unrelated route lines
          const cur = toLatLng(ship.currentLocation?.lat, ship.currentLocation?.lng);
          if (!cur) return null;
          const legPoints: [number,number][] = [];
          if (Array.isArray(ship.routeLegs)) {
            for (const leg of ship.routeLegs) {
              if (leg && typeof leg === "object" && leg.endLocation) {
                const ep = toLatLng(leg.endLocation.lat, leg.endLocation.lng);
                if (ep) legPoints.push(ep);
              }
            }
          }
          const path: [number,number][] = [cur, ...legPoints];
          if (path.length < 2) return null;
          return (
            <Polyline key={`route-${i}`} positions={path}
              pathOptions={{ color:"#3b82f6", weight:1.5, opacity: focusSet ? 0.35 : 0.2, dashArray:"5 7" }} />
          );
        })}

        {/* ── BLOCKED route (red dashed) ────────────────────────────────────
            Shown only in comparison mode.
        ─────────────────────────────────────────────────────────────────── */}
        {showComparison && safeBlockedPath.length >= 2 && (<>
          <Polyline positions={safeBlockedPath}
            pathOptions={{ color:"#ef4444", weight:3, opacity:0.8, dashArray:"5 6" }} />
          <Marker position={safeBlockedPath[0]}
            icon={makeWaypointIcon(activeRecMeta?.origin ?? "Origin", "#ef4444")}
            zIndexOffset={400} />
          <Marker position={safeBlockedPath[safeBlockedPath.length - 1]}
            icon={makeWaypointIcon(activeRecMeta?.destination ?? "Dest", "#f87171")}
            zIndexOffset={400} />
        </>)}

        {/* ── AI REROUTE path (animated green) ─────────────────────────────── */}
        {showComparison && (<>
          <Polyline positions={safeReroutePath}
            pathOptions={{ color:"#34d399", weight:3.5, opacity:1,
              dashArray:"10 6", className:"reroute-march" }} />
          {rerouteWaypoints.map((wp, i) => (
            <Marker key={`wp-${i}`} position={wp.pos}
              icon={makeWaypointIcon(
                wp.label,
                i === 0 ? "#60a5fa"
                : i === rerouteWaypoints.length - 1 ? "#34d399"
                : "#f59e0b"
              )}
              zIndexOffset={500} />
          ))}
        </>)}

        {/* ── Fleet dispatch line (cyan dotted) ────────────────────────────── */}
        {showComparison && fleetDispatchLine && (<>
          <Polyline positions={[fleetDispatchLine.from, fleetDispatchLine.to]}
            pathOptions={{ color:"#22d3ee", weight:1.5, opacity:0.7, dashArray:"4 6" }} />
          <Marker position={fleetDispatchLine.from}
            icon={makeWaypointIcon(fleetDispatchLine.assetId, "#22d3ee")}
            zIndexOffset={450} />
        </>)}

        {/* ── Shipment markers ─────────────────────────────────────────────── */}
        {shipments.map((ship, i) => {
          const pos = toLatLng(ship.currentLocation?.lat, ship.currentLocation?.lng);
          if (!pos) return null;
          const focused = isShipFocused(ship.shipmentId);
          // In comparison mode, fully hide non-focused shipments
          if (showComparison && !focused) return null;
          return (
            <Marker key={`ship-${i}`} position={pos}
              icon={getShipmentIcon(ship, lifeClocks?.[ship.shipmentId])}
              opacity={focused ? FULL_OPACITY : DIM_OPACITY}
              zIndexOffset={focused ? 200 : 10}
            >
              <Popup className="cc-popup" maxWidth={230}><ShipmentPopup s={ship} clock={lifeClocks?.[ship.shipmentId]} /></Popup>
            </Marker>
          );
        })}

        {/* ── Fleet markers ────────────────────────────────────────────────── */}
        {/* In comparison mode: hide all fleet markers (the dispatch line is enough).
            In scenario mode:   show only fleet trucks near the disruption zone.
            Idle:               show all. */}
        {!showComparison && fleets.map((fleet, i) => {
          const pos = toLatLng(fleet.currentLocation?.lat, fleet.currentLocation?.lng);
          if (!pos) return null;
          // In scenario (focus) mode, dim fleet trucks that aren't the dispatched one
          const isDispatchedFleet = fleetDispatchLine?.assetId === fleet.assetId;
          const opacity = (focusSet && !isDispatchedFleet) ? DIM_OPACITY : FULL_OPACITY;
          return (
            <Marker key={`fleet-${i}`} position={pos} icon={truckIcon} opacity={opacity}>
              <Popup className="cc-popup" maxWidth={210}><FleetPopup f={fleet} /></Popup>
            </Marker>
          );
        })}

        {/* ── Disruption zone ──────────────────────────────────────────────── */}
        {disruptions.map((d, i) => {
          const pos = toLatLng(d.geometry?.lat, d.geometry?.lng);
          if (!pos) return null;
          return (
            <React.Fragment key={`dis-${i}`}>
              <Circle center={pos} radius={80000}
                pathOptions={{ color:"#ef4444", fillColor:"#ef4444", fillOpacity:0.07,
                  weight:1.5, opacity:0.8, dashArray:"6 8", className:"disruption-outer-ring" }} />
              <Marker position={pos} icon={alertIcon} zIndexOffset={200}>
                <Popup className="cc-popup" maxWidth={220}><DisruptionPopup d={d} /></Popup>
              </Marker>
            </React.Fragment>
          );
        })}
      </MapContainer>

      {/* ── Control overlay (top-right) ─────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
        <button onClick={() => mapRef.current?.zoomIn(1)}
          className="w-8 h-8 rounded-lg bg-slate-900/90 border border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center text-base font-light backdrop-blur-sm shadow-lg"
          title="Zoom in">+</button>
        <button onClick={() => mapRef.current?.zoomOut(1)}
          className="w-8 h-8 rounded-lg bg-slate-900/90 border border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center text-base font-light backdrop-blur-sm shadow-lg"
          title="Zoom out">−</button>
        <div className="h-px bg-slate-800 mx-1" />
        <button onClick={fitAll}
          className="w-8 h-8 rounded-lg bg-slate-900/90 border border-blue-700/40 text-blue-400 hover:bg-blue-900/30 hover:border-blue-500 transition-all flex items-center justify-center backdrop-blur-sm shadow-lg"
          title="Fit all shipments">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
          </svg>
        </button>
        {disruptions.length > 0 && (
          <button onClick={fitDisruptions}
            className="w-8 h-8 rounded-lg bg-slate-900/90 border border-red-700/40 text-red-400 hover:bg-red-900/30 hover:border-red-500 transition-all flex items-center justify-center backdrop-blur-sm shadow-lg animate-pulse"
            title="Zoom to disruption">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Top-left: status badges + Before/After panel ─────────────────────── */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1.5 max-w-[320px]">
        {/* Status badges — always visible */}
        {!showComparison && (
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold bg-[#060b14]/80 border border-blue-500/25 text-blue-400 px-2 py-0.5 rounded-full backdrop-blur-sm">
              {shipments.length} shipments
            </span>
            <span className="text-[10px] font-bold bg-[#060b14]/80 border border-emerald-500/25 text-emerald-400 px-2 py-0.5 rounded-full backdrop-blur-sm">
              {fleets.length} idle fleet
            </span>
            {disruptions.length > 0 && (
              <span className="text-[10px] font-bold bg-[#060b14]/80 border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full backdrop-blur-sm animate-pulse">
                ▲ {disruptions.length} disruption{disruptions.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {/* ── BEFORE / AFTER explanation panel — shown when Map is clicked ────
            Replaces the tiny banner with a full structured story:
              PROBLEM section: what was blocked and why
              AI SOLUTION section: the new route with concrete metrics
        ─────────────────────────────────────────────────────────────────── */}
        {showComparison && activeRecMeta && (
          <div data-tour="map-comparison" className="bg-[#060b14]/95 border border-slate-700/60 rounded-xl overflow-hidden backdrop-blur-md shadow-2xl shadow-black/60 w-[310px]">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/60 bg-slate-900/40">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">AI Route Comparison</span>
              </div>
              <span className="text-[9px] font-mono text-slate-600">{activeRecMeta.shipmentId}</span>
            </div>

            {/* PROBLEM row */}
            <div className="px-3 pt-2.5 pb-2 border-b border-slate-800/40">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[8px] font-bold uppercase tracking-widest text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Problem</span>
                <span className="text-[9px] text-slate-600">Why the original route failed</span>
              </div>
              <div className="flex items-start gap-2">
                {/* Red blocked route indicator */}
                <div className="flex flex-col items-center gap-0.5 pt-1 flex-shrink-0">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="w-px h-4 bg-red-500/30" />
                  <span className="w-2 h-2 rounded-full bg-red-500/50" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-300 font-semibold">
                    {activeRecMeta.origin} → {activeRecMeta.destination}
                  </div>
                  <div className="text-[10px] text-red-400 mt-0.5 leading-snug">
                    ✕ Blocked by {activeRecMeta.disruption}
                  </div>
                  <div className="text-[9px] text-slate-600 mt-0.5">
                    {activeRecMeta.cargo} cargo · route now impassable
                  </div>
                </div>
              </div>
            </div>

            {/* AI SOLUTION row */}
            <div className="px-3 pt-2.5 pb-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[8px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">AI Solution</span>
                <span className="text-[9px] text-slate-600">Recommended alternate route</span>
              </div>
              <div className="flex items-start gap-2">
                {/* Green route indicator */}
                <div className="flex flex-col items-center gap-0.5 pt-1 flex-shrink-0">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  {rerouteLabels && rerouteLabels.slice(1, -1).map((_, j) => (
                    <React.Fragment key={j}>
                      <span className="w-px h-3 bg-emerald-500/40" />
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
                    </React.Fragment>
                  ))}
                  <span className="w-px h-3 bg-emerald-500/40" />
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-emerald-300 font-semibold leading-snug">
                    {rerouteLabels?.join(" → ") || activeRecMeta.routeLabel}
                  </div>
                  {/* Metrics grid */}
                  <div className="grid grid-cols-3 gap-1.5 mt-2">
                    <div className="bg-slate-900/60 rounded-lg px-1.5 py-1 text-center">
                      <div className={`text-[11px] font-black ${activeRecMeta.costDelta > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {activeRecMeta.costDelta === 0 ? "—" : activeRecMeta.costDelta > 0 ? `+$${(activeRecMeta.costDelta/1000).toFixed(1)}k` : `-$${(Math.abs(activeRecMeta.costDelta)/1000).toFixed(1)}k`}
                      </div>
                      <div className="text-[8px] text-slate-600 mt-0.5">cost</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg px-1.5 py-1 text-center">
                      <div className={`text-[11px] font-black ${activeRecMeta.timeDeltaHours > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {activeRecMeta.timeDeltaHours === 0 ? "same" : activeRecMeta.timeDeltaHours > 0 ? `+${activeRecMeta.timeDeltaHours}h` : `${activeRecMeta.timeDeltaHours}h`}
                      </div>
                      <div className="text-[8px] text-slate-600 mt-0.5">time</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg px-1.5 py-1 text-center">
                      <div className="text-[11px] font-black text-emerald-400">{activeRecMeta.riskScore}</div>
                      <div className="text-[8px] text-slate-600 mt-0.5">risk</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer hint */}
            <div className="px-3 py-1.5 border-t border-slate-800/40 bg-slate-900/20">
              <div className="text-[8px] text-slate-700">
                <span className="text-red-500/60">━━</span> blocked &nbsp;
                <span className="text-emerald-400/60">╌╌</span> AI reroute &nbsp;
                {fleetDispatchLine && <><span className="text-cyan-400/60">╌╌</span> fleet dispatch &nbsp;</>}
                ·&nbsp; approve in Action Center →
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Legend (bottom-left) — compact when comparison is active ─────────── */}
      <div className="absolute bottom-8 left-3 z-[1000] bg-[#060b14]/90 border border-slate-800 rounded-xl px-3 py-2.5 backdrop-blur-sm">
        <div className="text-[8px] font-bold uppercase tracking-widest text-slate-700 mb-2">Map Legend</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-[9px] text-slate-500">Shipment (normal)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="text-[9px] text-slate-500">Shipment (at risk)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 border-t border-dashed border-blue-500/40 flex-shrink-0" />
            <span className="text-[9px] text-slate-500">Planned route</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="text-[9px] text-slate-500">Idle fleet asset</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500/50 border border-red-500 flex-shrink-0" />
            <span className="text-[9px] text-slate-500">Disruption zone</span>
          </div>
          {showComparison && (
            <div className="pt-1 border-t border-slate-800 mt-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-4 border-t-2 border-red-500/70 border-dashed flex-shrink-0" />
                <span className="text-[9px] text-red-400/80">Blocked route</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 border-t-2 border-dashed border-emerald-400 flex-shrink-0" />
                <span className="text-[9px] text-emerald-400 font-semibold">AI reroute</span>
              </div>
              {fleetDispatchLine && (
                <div className="flex items-center gap-2">
                  <span className="w-4 border-t border-dashed border-cyan-400/70 flex-shrink-0" />
                  <span className="text-[9px] text-cyan-400/80">Fleet dispatch</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
