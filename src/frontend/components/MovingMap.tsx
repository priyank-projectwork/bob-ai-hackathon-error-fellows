"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Circle, Marker, Tooltip, useMap } from "react-leaflet";
import { shipmentPin } from "./mapIcons";
import "leaflet/dist/leaflet.css";
import { api, API, type MovingShipment, type LifeClock, type ClockState } from "@/lib/api";

interface DisruptionZone {
  id: string;
  title?: string;
  type?: string;
  centre: [number, number];
  radiusKm: number;
}

const STATE_COLOUR: Record<ClockState, string> = {
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  black: "#991b1b",
};

/** Keep the view on whatever the operator selected, without fighting them. */
/**
 * Fly to a shipment when the operator SELECTS it — once.
 *
 * Keying this on the position array re-ran it on every 2-second poll, so the
 * map yanked itself back and re-zoomed while you were trying to look around.
 * It now fires only when the selected id changes, and never touches the zoom
 * the operator has chosen.
 */
function FlyToSelection({
  selectedId,
  getPosition,
}: {
  selectedId: string | null | undefined;
  getPosition: (id: string) => [number, number] | null;
}) {
  const map = useMap();
  const lastFlown = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId || lastFlown.current === selectedId) return;
    const pos = getPosition(selectedId);
    if (!pos) return;
    lastFlown.current = selectedId;
    // Keep whatever zoom the operator is on; just centre on the shipment.
    map.panTo([pos[1], pos[0]], { animate: true, duration: 0.7 });
  }, [selectedId, map, getPosition]);

  useEffect(() => {
    if (!selectedId) lastFlown.current = null;
  }, [selectedId]);

  return null;
}

/** "Fit everything" and "follow the selection" as explicit operator choices. */
function MapControls({
  shipments,
  selectedId,
  getPosition,
}: {
  shipments: MovingShipment[];
  selectedId: string | null | undefined;
  getPosition: (id: string) => [number, number] | null;
}) {
  const map = useMap();

  const fitAll = () => {
    const pts = shipments.filter((s) => s.position).map((s) => [s.position![1], s.position![0]] as [number, number]);
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 5 });
  };

  const centreSelected = () => {
    if (!selectedId) return;
    const pos = getPosition(selectedId);
    if (pos) map.setView([pos[1], pos[0]], Math.max(map.getZoom(), 5), { animate: true });
  };

  return (
    <div className="absolute right-3 top-14 z-[500] flex flex-col gap-1.5">
      <button onClick={fitAll} className="lc-btn px-2.5 py-1 text-xs" title="Fit every shipment in view">
        Fit all
      </button>
      <button
        onClick={centreSelected}
        disabled={!selectedId}
        className="lc-btn px-2.5 py-1 text-xs disabled:opacity-40"
        title="Centre on the selected shipment"
      >
        Centre
      </button>
    </div>
  );
}

/**
 * The world, moving.
 *
 * Positions come from /api/v1/world, which computes them from each shipment's
 * route, speed and the simulated clock — so the dots move because the world
 * moves, not because of an animation loop in the browser.
 *
 * Each marker is coloured by its life clock, so "this cargo is running out of
 * time" is visible on the map rather than buried in a panel.
 */
export default function MovingMap({
  selected,
  onSelect,
}: {
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [shipments, setShipments] = useState<MovingShipment[]>([]);
  const [clocks, setClocks] = useState<Record<string, LifeClock>>({});
  const [error, setError] = useState<string | null>(null);
  const [disruptions, setDisruptions] = useState<DisruptionZone[]>([]);
  const sonarKey = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [world, lc] = await Promise.all([api.world(), api.lifeClocks()]);
        if (!alive) return;
        // Disruption zones are optional — the map still works without them.
        try {
          const res = await fetch(`${API}/api/locations`);
          if (res.ok) {
            const body = await res.json();
            setDisruptions(
              (body.disruptions ?? [])
                .filter((d: any) => d?.geometry?.lat != null && d?.geometry?.lng != null)
                .map((d: any) => ({
                  id: String(d._id ?? d.title),
                  title: d.title,
                  type: d.type,
                  centre: [d.geometry.lng, d.geometry.lat] as [number, number],
                  radiusKm: d.geometry.radius ?? 80,
                }))
            );
          }
        } catch { /* zones are decoration, never block the map */ }
        setShipments(world.shipments.filter((s) => s.position));
        setClocks(Object.fromEntries(lc.clocks.map((c) => [c.shipmentId, c])));
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "could not load the world");
      }
    };
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => { sonarKey.current += 1; }, [selected]);

  // Reading positions through a ref keeps FlyToSelection from re-running on
  // every poll just because the array identity changed.
  const positionsRef = useRef<Record<string, [number, number]>>({});
  positionsRef.current = Object.fromEntries(
    shipments.filter((s) => s.position).map((s) => [s.shipmentId, s.position as [number, number]])
  );
  const positionOf = useCallback((id: string) => positionsRef.current[id] ?? null, []);

  const selectedShipment = useMemo(
    () => shipments.find((s) => s.shipmentId === selected) ?? null,
    [shipments, selected]
  );

  if (error) {
    return (
      <div className="lc-card flex h-[520px] items-center justify-center" style={{ borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
        <p className="text-sm">Map unavailable — {error}</p>
      </div>
    );
  }

  return (
    <div className="lc-card lc-map relative h-[520px] overflow-hidden">
      <MapContainer center={[20, 40]} zoom={3} className="h-full w-full" worldCopyJump>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {/* The selected shipment's route: what is done, and what is left. */}
        {selectedShipment?.routeCoords && (
          <Polyline
            positions={selectedShipment.routeCoords.map(([lng, lat]) => [lat, lng])}
            pathOptions={{ color: "#475569", weight: 2, opacity: 0.5 }}
          />
        )}
        {selectedShipment?.remainingPath && (
          <Polyline
            positions={selectedShipment.remainingPath.map(([lng, lat]) => [lat, lng])}
            className="lc-remaining"
            pathOptions={{ color: "#38bdf8", weight: 3, opacity: 0.95, dashArray: "10 8" }}
          />
        )}

        {/* Disruption zones breathe so they read as live, not drawn-on. */}
        {disruptions.map((d) => (
          <Circle
            key={d.id}
            center={[d.centre[1], d.centre[0]]}
            radius={d.radiusKm * 1000}
            className="lc-zone"
            pathOptions={{ color: "#f97316", weight: 1.5, fillColor: "#f97316", fillOpacity: 0.18 }}
          >
            <Tooltip direction="top">
              <div className="text-xs">
                <div className="font-semibold">{d.title ?? d.type}</div>
                <div>{d.radiusKm} km zone</div>
              </div>
            </Tooltip>
          </Circle>
        ))}

        {/* One ring out from whatever was just selected. */}
        {selectedShipment?.position && (
          <CircleMarker
            key={`sonar-${selected}-${sonarKey.current}`}
            center={[selectedShipment.position[1], selectedShipment.position[0]]}
            radius={8}
            className="lc-sonar"
            pathOptions={{ color: "#38bdf8", weight: 3, fill: false }}
            interactive={false}
          />
        )}

        {shipments.map((s) => {
          const clock = clocks[s.shipmentId];
          const state: ClockState = clock?.state ?? "green";
          const isSelected = s.shipmentId === selected;
          const [lng, lat] = s.position!;
          return (
            <Marker
              key={s.shipmentId}
              position={[lat, lng]}
              icon={shipmentPin({
                mode: s.transportMode ?? "Road",
                state,
                bearing: s.bearing ?? 0,
                selected: isSelected,
                halted: s.halted,
                label: isSelected ? s.shipmentId : undefined,
              })}
              eventHandlers={{ click: () => onSelect?.(s.shipmentId) }}
            >
              <Tooltip direction="top" offset={[0, -20]} opacity={1} sticky={false}>
                <div className="text-xs leading-relaxed">
                  <div className="font-mono font-semibold">{s.shipmentId}</div>
                  <div>
                    {s.transportMode} · {Math.round((s.fractionDone ?? 0) * 100)}% of route
                  </div>
                  {clock && (
                    <div>
                      life clock <strong>{clock.lifeClockH.toFixed(1)} h</strong> ({clock.bindingConstraint})
                    </div>
                  )}
                  {s.tempC != null && (
                    <div>
                      {s.tempC.toFixed(1)} °C · {s.unitMode}
                    </div>
                  )}
                  {s.halted && <div className="font-medium">held</div>}
                </div>
              </Tooltip>
            </Marker>
          );
        })}

        <FlyToSelection selectedId={selected} getPosition={positionOf} />
        <MapControls shipments={shipments} selectedId={selected} getPosition={positionOf} />
      </MapContainer>

      <div className="lc-card pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-col gap-1 px-3 py-2 text-xs">
        <span className="font-medium">Life clock</span>
        {(["green", "amber", "red", "black"] as ClockState[]).map((s) => (
          <span key={s} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_COLOUR[s] }} />
            {s === "green" ? "over 24 h" : s === "amber" ? "under 24 h" : s === "red" ? "under 6 h" : "unusable"}
          </span>
        ))}
      </div>

      <div className="lc-card pointer-events-none absolute right-3 top-3 z-[500] px-3 py-1.5 text-xs font-medium">
        {shipments.length} shipments · {shipments.filter((s) => s.moving).length} moving
      </div>
    </div>
  );
}
