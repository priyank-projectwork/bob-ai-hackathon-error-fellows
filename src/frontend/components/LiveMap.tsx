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
// Reject [0,0] (null island), NaN, or anything outside the continental US bbox.
// This is the root cause of "random lines to nowhere" — Leaflet draws to [0,0]
// when a coordinate comes back as undefined from an unpopulated routeLeg.
function validCoord(pt: any): pt is [number, number] {
  if (!Array.isArray(pt) || pt.length < 2) return false;
  const [lat, lng] = pt;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;             // null island
  if (lat < 18 || lat > 72) return false;               // outside N America
  if (lng < -170 || lng > -50) return false;
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

const SHIP_SVG  = `<path d="M2 21c4 0 7-2 9-2s5 2 9 2c-4 0-7-2-9-2s-5 2-9 2"/><path d="M19 19V11a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v8"/><path d="M12 9V5a2 2 0 0 1 2-2h1"/>`;
const TRUCK_SVG = `<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`;
const ALERT_SVG = `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`;

const shipIcon     = makeIcon("#3b82f6", SHIP_SVG);
const shipRiskIcon = makeIcon("#ef4444", SHIP_SVG, true);
const truckIcon    = makeIcon("#22c55e", TRUCK_SVG);
const alertIcon    = makeIcon("#ef4444", ALERT_SVG, true);

// ─── Injected CSS ─────────────────────────────────────────────────────────────

const MAP_STYLES = `
@keyframes iconSonar {
  0%   { transform:scale(0.8); opacity:0.6; }
  80%  { transform:scale(2.8); opacity:0; }
  100% { transform:scale(2.8); opacity:0; }
}
.leaflet-tile {
  filter: invert(1) hue-rotate(180deg) brightness(0.65) contrast(1.25) saturate(0.8);
}
.leaflet-container { background:#060b14 !important; }
.leaflet-attribution-flag { display:none !important; }
.leaflet-control-attribution {
  background:rgba(6,11,20,0.75) !important; color:#334155 !important;
  font-size:8px !important; border-radius:4px !important; padding:2px 5px !important;
}
.cc-popup .leaflet-popup-content-wrapper {
  background:#0b1424; border:1px solid #1e3a5f; border-radius:12px;
  color:#cbd5e1; font-size:12px; padding:0;
  box-shadow:0 16px 48px rgba(0,0,0,0.8); min-width:170px;
}
.cc-popup .leaflet-popup-content { margin:0; }
.cc-popup .leaflet-popup-tip-container { margin-top:-1px; }
.cc-popup .leaflet-popup-tip { background:#0b1424; }
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

function FlyToController({ target }: { target: { lat:number; lng:number; zoom:number; seq:number } | null }) {
  const map = useMap();
  const lastSeq = useRef(-1);
  useEffect(() => {
    if (!target) return;
    if (target.seq === lastSeq.current) return;
    lastSeq.current = target.seq;
    map.flyTo([target.lat, target.lng], target.zoom, { animate: true, duration: 1.6 });
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

function ShipmentPopup({ s }: { s: any }) {
  const rs = s.riskScore ?? 0;
  const col = rs >= 75 ? "#f87171" : rs >= 50 ? "#fb923c" : rs >= 25 ? "#fbbf24" : "#34d399";
  const lbl = rs >= 75 ? "CRITICAL" : rs >= 50 ? "HIGH" : rs >= 25 ? "WATCH" : "NORMAL";
  return (
    <div style={{ padding:"13px 15px", minWidth:200, fontFamily:"system-ui,sans-serif" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <span style={{ fontWeight:800, color:"#f1f5f9", fontSize:12 }}>{s.shipmentId}</span>
        <span style={{ background:`${col}18`, color:col, border:`1px solid ${col}55`,
          borderRadius:5, fontSize:9, fontWeight:800, padding:"2px 7px", letterSpacing:"0.1em" }}>{lbl}</span>
      </div>
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

interface LiveMapProps {
  disruptions: any[];
  shipments: any[];
  fleets: any[];
  rerouteShipmentId?: string | null;
  reroutePath?: [number, number][];
  rerouteLabels?: string[];       // city names for each point in reroutePath
  flyTo?: { lat:number; lng:number; zoom?:number; seq?:number } | null;
  spotlight?: { lat:number; lng:number; label:string; type:string } | null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LiveMap({
  disruptions, shipments, fleets,
  rerouteShipmentId, reroutePath, rerouteLabels,
  flyTo, spotlight,
}: LiveMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const center: [number, number] = [38.5, -96.5];

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
    ? { lat: flyTo.lat, lng: flyTo.lng, zoom: flyTo.zoom ?? 5, seq: flyTo.seq ?? 0 }
    : null;

  // Build safe waypoints for the reroute path with labels
  const rerouteWaypoints: RerouteWaypoint[] = (reroutePath ?? [])
    .map((pt, i) => {
      if (!validCoord(pt)) return null;
      const label = rerouteLabels?.[i] ?? (i === 0 ? "Origin" : i === (reroutePath!.length - 1) ? "Dest" : `WP${i}`);
      return { pos: pt, label, isEndpoint: i === 0 || i === (reroutePath!.length - 1) };
    })
    .filter(Boolean) as RerouteWaypoint[];

  const safeReroutePath = rerouteWaypoints.map(w => w.pos);

  return (
    <div className="w-full h-[500px] relative z-0">
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

        {/* ── Current route lines (planned path for each shipment) ─────────
            Draw: origin → current location → destination
            Only use real, validated coordinates. Skip any leg with bad data.
            Color: dim blue dashed = planned remaining path
        ─────────────────────────────────────────────────────────────────── */}
        {shipments.map((ship, i) => {
          if (ship.shipmentId === rerouteShipmentId) return null;

          const cur = toLatLng(ship.currentLocation?.lat, ship.currentLocation?.lng);
          if (!cur) return null;

          // Collect leg endpoints — only include legs that are proper populated objects
          // (not bare ObjectId strings, which arrive when populate() wasn't called)
          const legPoints: [number,number][] = [];
          if (Array.isArray(ship.routeLegs)) {
            for (const leg of ship.routeLegs) {
              // A populated leg has startLocation and endLocation objects
              if (leg && typeof leg === "object" && leg.endLocation) {
                const ep = toLatLng(leg.endLocation.lat, leg.endLocation.lng);
                if (ep) legPoints.push(ep);
              }
              // If it's just an ObjectId string/object, skip — don't draw
            }
          }

          // Build path: current location → destination (via leg endpoints)
          // If no populated legs, just draw current → nothing (single point, skip)
          const path: [number,number][] = [cur, ...legPoints];
          if (path.length < 2) return null;

          return (
            <Polyline key={`route-${i}`} positions={path}
              pathOptions={{ color:"#3b82f6", weight:1.5, opacity:0.25, dashArray:"5 7" }} />
          );
        })}

        {/* ── Reroute path (AI suggested alternate route) ──────────────────
            Shown when:
              - "Map" button clicked in Action Center (preview, no commit)
              - "Approve" button clicked (committed reroute)
            Full path: shipment location → via city waypoints → destination
            Only draws if all coordinates are valid.
        ─────────────────────────────────────────────────────────────────── */}
        {rerouteShipmentId && safeReroutePath.length >= 2 && (<>
          {/* Glow layer */}
          <Polyline positions={safeReroutePath}
            pathOptions={{ color:"#34d399", weight:8, opacity:0, className:"reroute-glow" }} />
          {/* Animated dashed line */}
          <Polyline positions={safeReroutePath}
            pathOptions={{ color:"#34d399", weight:2.5, opacity:1,
              dashArray:"10 6", className:"reroute-march" }} />

          {/* Waypoint markers with city name labels */}
          {rerouteWaypoints.map((wp, i) => (
            <Marker
              key={`wp-${i}`}
              position={wp.pos}
              icon={makeWaypointIcon(
                wp.label,
                i === 0 ? "#3b82f6"                          // origin = blue
                : i === rerouteWaypoints.length - 1 ? "#34d399"  // dest = green
                : "#f59e0b"                                   // waypoint = amber
              )}
              zIndexOffset={500}
            />
          ))}
        </>)}

        {/* ── Shipment markers ─────────────────────────────────────────────── */}
        {shipments.map((ship, i) => {
          const pos = toLatLng(ship.currentLocation?.lat, ship.currentLocation?.lng);
          if (!pos) return null;
          return (
            <Marker key={`ship-${i}`} position={pos}
              icon={(ship.riskScore ?? 0) >= 50 ? shipRiskIcon : shipIcon}
              zIndexOffset={100}
            >
              <Popup className="cc-popup" maxWidth={230}><ShipmentPopup s={ship} /></Popup>
            </Marker>
          );
        })}

        {/* ── Fleet markers ────────────────────────────────────────────────── */}
        {fleets.map((fleet, i) => {
          const pos = toLatLng(fleet.currentLocation?.lat, fleet.currentLocation?.lng);
          if (!pos) return null;
          return (
            <Marker key={`fleet-${i}`} position={pos} icon={truckIcon}>
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
                pathOptions={{ color:"#ef4444", fillColor:"#ef4444", fillOpacity:0.05,
                  weight:1.5, opacity:0.7, dashArray:"6 8", className:"disruption-outer-ring" }} />
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

      {/* ── Status badges (top-left) ─────────────────────────────────────────── */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1.5">
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
        {/* Reroute banner — explains what the green line is */}
        {rerouteShipmentId && safeReroutePath.length >= 2 && (
          <div className="flex items-center gap-2 bg-emerald-950/90 border border-emerald-700/50 rounded-lg px-2.5 py-1.5 backdrop-blur-sm max-w-[260px]">
            <span className="w-4 border-t-2 border-dashed border-emerald-400 flex-shrink-0" />
            <div>
              <div className="text-[10px] font-bold text-emerald-400">AI Reroute Preview</div>
              <div className="text-[9px] text-emerald-700 leading-snug">
                {rerouteShipmentId} · {safeReroutePath.length - 1} leg{safeReroutePath.length > 2 ? "s" : ""} via {rerouteLabels?.slice(1, -1).join(" → ") || "alternate route"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Legend (bottom-left) ─────────────────────────────────────────────── */}
      <div className="absolute bottom-8 left-3 z-[1000] bg-[#060b14]/90 border border-slate-800 rounded-xl px-3 py-2.5 backdrop-blur-sm">
        <div className="text-[8px] font-bold uppercase tracking-widest text-slate-700 mb-2">Map Legend</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-[9px] text-slate-500">Shipment (normal)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="text-[9px] text-slate-500">Shipment (high risk)</span>
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
          {rerouteShipmentId && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-800 mt-1">
              <span className="w-4 border-t-2 border-dashed border-emerald-400 flex-shrink-0" />
              <span className="text-[9px] text-emerald-500 font-semibold">AI reroute path</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
