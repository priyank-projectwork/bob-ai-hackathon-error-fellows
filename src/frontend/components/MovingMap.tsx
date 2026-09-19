"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Circle, Tooltip, useMap } from "react-leaflet";
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
function FlyTo({ position }: { position: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo([position[1], position[0]], 4, { duration: 0.8 });
  }, [position, map]);
  return null;
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

  const selectedShipment = useMemo(
    () => shipments.find((s) => s.shipmentId === selected) ?? null,
    [shipments, selected]
  );

  if (error) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-red-500/40 bg-red-500/5">
        <p className="text-sm">Map unavailable — {error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-[520px] overflow-hidden rounded-lg border border-slate-700/50">
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
          const colour = STATE_COLOUR[state];
          const isSelected = s.shipmentId === selected;
          const [lng, lat] = s.position!;
          // Only shipments in trouble pulse, and the worse it is the faster.
          const pulse =
            state === "black" ? "lc-pulse-black"
            : state === "red" ? "lc-pulse-red"
            : state === "amber" ? "lc-pulse-amber"
            : "";
          return (
            <CircleMarker
              key={s.shipmentId}
              center={[lat, lng]}
              radius={isSelected ? 9 : state === "green" ? 5 : 7}
              className={`lc-marker ${pulse}`}
              pathOptions={{
                color: isSelected ? "#ffffff" : colour,
                weight: isSelected ? 3 : 1.5,
                fillColor: colour,
                fillOpacity: s.halted ? 0.35 : 0.85,
              }}
              eventHandlers={{ click: () => onSelect?.(s.shipmentId) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div className="text-xs">
                  <div className="font-mono font-semibold">{s.shipmentId}</div>
                  <div>
                    {s.transportMode} · {Math.round((s.fractionDone ?? 0) * 100)}% of route
                  </div>
                  {clock && (
                    <div>
                      life clock {clock.lifeClockH.toFixed(1)} h ({clock.bindingConstraint})
                    </div>
                  )}
                  {s.tempC != null && <div>{s.tempC.toFixed(1)} °C · {s.unitMode}</div>}
                  {s.halted && <div className="font-medium">held</div>}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        <FlyTo position={selectedShipment?.position ?? null} />
      </MapContainer>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded bg-slate-900/85 px-3 py-2 text-xs">
        <span className="font-medium">Life clock</span>
        {(["green", "amber", "red", "black"] as ClockState[]).map((s) => (
          <span key={s} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_COLOUR[s] }} />
            {s === "green" ? "over 24 h" : s === "amber" ? "under 24 h" : s === "red" ? "under 6 h" : "unusable"}
          </span>
        ))}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 rounded bg-slate-900/85 px-3 py-1.5 text-xs">
        {shipments.length} shipments · {shipments.filter((s) => s.moving).length} moving
      </div>
    </div>
  );
}
