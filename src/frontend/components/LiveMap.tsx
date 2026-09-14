"use client";
import React from 'react';

import { MapContainer, TileLayer, Marker, Circle, Popup, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const createIcon = (svgPath: string, color: string) =>
  L.divIcon({
    className: "custom-icon",
    html: `<div style="background-color: ${color}; width: 28px; height: 28px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color}; display: flex; align-items: center; justify-content: center;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

const truckSvg = `<rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>`;
const shipSvg = `<path d="M2 21c4 0 7-2 9-2s5 2 9 2c-4 0-7-2-9-2s-5 2-9 2z"></path><path d="M19 19V11a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v8"></path><path d="M12 9V5a2 2 0 0 1 2-2h1"></path>`;
const alertSvg = `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>`;

const truckIcon = createIcon(truckSvg, "#22c55e");
const shipIcon = createIcon(shipSvg, "#3b82f6");
const alertIcon = createIcon(alertSvg, "#ef4444");

interface LiveMapProps {
  disruptions: any[];
  shipments: any[];
  fleets: any[];
}

export default function LiveMap({ disruptions, shipments, fleets }: LiveMapProps) {
  const centerPosition: [number, number] = [38.0, -97.0]; // Center of US for better view of NY -> LA routes

  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden border border-slate-700 shadow-xl relative z-0">
      <div className="absolute inset-0 [&_.leaflet-layer]:filter [&_.leaflet-layer]:invert [&_.leaflet-layer]:hue-rotate-180 [&_.leaflet-layer]:brightness-75 [&_.leaflet-layer]:contrast-125">
        <MapContainer
          center={centerPosition}
          zoom={4}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap'
          />

          {/* Render Routes */}
          {shipments.map((ship, index) => {
            if (ship.routeLegs && ship.routeLegs.length > 0) {
              const path: [number, number][] = [];
              if (ship.currentLocation) {
                path.push([ship.currentLocation.lat, ship.currentLocation.lng]);
              }
              ship.routeLegs.forEach((leg: any) => {
                if (leg.endLocation) {
                  path.push([leg.endLocation.lat, leg.endLocation.lng]);
                }
              });
              
              if (path.length > 1) {
                return (
                  <Polyline key={`route-${index}`} positions={path} pathOptions={{ color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: "4 4" }} />
                );
              }
            }
            return null;
          })}

          {/* Render Shipments */}
          {shipments.map((ship, index) => {
            if (!ship.currentLocation) return null;
            return (
              <Marker 
                key={`ship-${index}`} 
                position={[ship.currentLocation.lat, ship.currentLocation.lng]} 
                icon={shipIcon}
              >
                <Popup>Shipment: {ship.shipmentId} (Risk: {ship.riskScore})</Popup>
              </Marker>
            );
          })}

          {/* Render Fleets */}
          {fleets.map((fleet, index) => {
            if (!fleet.currentLocation) return null;
            return (
              <Marker 
                key={`fleet-${index}`} 
                position={[fleet.currentLocation.lat, fleet.currentLocation.lng]} 
                icon={truckIcon}
              >
                <Popup>Idle Asset: {fleet.assetId}</Popup>
              </Marker>
            );
          })}

          {/* Render Disruptions */}
          {disruptions.map((disruption, index) => {
            if (!disruption.geometry) return null;
            return (
              <React.Fragment key={`disruption-group-${index}`}>
                <Circle 
                  key={`disruption-circle-${index}`}
                  center={[disruption.geometry.lat, disruption.geometry.lng]}
                  radius={disruption.geometry.radius || 45000} // Much larger radius for visual impact on zoomed out map
                  color="red"
                  fillColor="#ef4444"
                  fillOpacity={0.4}
                />
                <Marker 
                  key={`disruption-marker-${index}`}
                  position={[disruption.geometry.lat, disruption.geometry.lng]}
                  icon={alertIcon}
                >
                  <Popup className="font-bold text-red-500">ACTIVE DISRUPTION: {disruption.title}</Popup>
                </Marker>
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>
      
      {/* Map Legend */}
      <div className="absolute bottom-4 right-4 bg-slate-900/90 p-3 rounded-lg border border-slate-700 z-[1000] backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 border border-white"></div>
          <span className="text-xs font-medium text-slate-300">Active Shipments</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full bg-green-500 border border-white"></div>
          <span className="text-xs font-medium text-slate-300">Idle Fleets</span>
        </div>
        {disruptions.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/50 border border-red-500"></div>
            <span className="text-xs font-bold text-red-400">Disruption Zone</span>
          </div>
        )}
      </div>
    </div>
  );
}
