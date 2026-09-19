/**
 * data/network.js — turns the node and lane tables into things the engines use.
 *
 * A lane is a list of legs; a leg is from-node, to-node, mode and optional
 * waypoints. This module flattens that into the GeoJSON coordinate array the
 * motion engine moves along, and into the graph edges the router searches.
 *
 * PURE: reads two JSON files at require time, no database, no clock.
 */
"use strict";

const nodes = require("./nodes.json");
const laneFile = require("./lanes.json");
const { haversineKm } = require("../engines/motion");

const NODES = Object.fromEntries(Object.entries(nodes).filter(([k]) => !k.startsWith("_")));
const LANES = laneFile.lanes;

/** Mode speeds used when a leg does not name one. [illustrative] */
const MODE_SPEED_KMH = { Road: 85, Sea: 35, Air: 820, Rail: 60 };

/** Rough cost per km by mode, USD per container-equivalent. [illustrative] */
const MODE_COST_PER_KM = { Road: 1.85, Sea: 0.09, Air: 4.40, Rail: 0.42 };

/** GLEC-style emission factors, kg CO2e per tonne-km. [illustrative] */
const MODE_CO2_PER_TONNE_KM = { Road: 0.062, Sea: 0.008, Air: 0.602, Rail: 0.022 };

function node(id) {
  const n = NODES[id];
  if (!n) throw new Error(`Unknown node '${id}'`);
  return n;
}

function coordsOf(id) {
  return node(id).coords;
}

/** The full node sequence a leg passes through, including its waypoints. */
function legNodeIds(leg) {
  return [leg.from, ...(leg.via ?? []), leg.to];
}

/** Coordinates for one leg. */
function legCoords(leg) {
  return legNodeIds(leg).map(coordsOf);
}

function legDistanceKm(leg) {
  const pts = legCoords(leg);
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
  return km;
}

function legSpeed(leg) {
  return leg.speedKmh ?? MODE_SPEED_KMH[leg.mode] ?? 60;
}

/** Dwell contributed by the nodes a leg ends at (ports, borders, canals). */
function legDwellHours(leg) {
  return legNodeIds(leg)
    .slice(1) // you do not dwell at your own origin
    .reduce((sum, id) => sum + (node(id).dwellHours ?? 0), 0);
}

/**
 * Fees attributable to ONE shipment.
 *
 * Canal tolls are charged per vessel transit, not per container. A Suez
 * transit is on the order of USD 465,000, but a 14,000 TEU ship spreads that
 * across its boxes — about USD 33 each. Billing a single pallet the whole toll
 * would make every Suez route look absurdly expensive and would be the kind of
 * mistake a freight person spots immediately.
 */
function legFeesUsd(leg, { teuShare = 1 } = {}) {
  return legNodeIds(leg)
    .slice(1)
    .reduce((sum, id) => {
      const n = node(id);
      const fee = n.feeUsd ?? 0;
      if (n.feeBasis === "vessel" && n.amortiseOverTeu) {
        return sum + (fee / n.amortiseOverTeu) * teuShare;
      }
      return sum + fee;
    }, 0);
}

function lane(id) {
  const l = LANES.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown lane '${id}'`);
  return l;
}

/**
 * Flatten a whole lane into one coordinate array, dropping the duplicate point
 * where one leg ends and the next begins.
 */
function laneCoords(laneId) {
  const l = lane(laneId);
  const out = [];
  for (const leg of l.legs) {
    const pts = legCoords(leg);
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out;
}

/** Summary of a lane: distance, transit hours, cost, CO2, dwell. */
function laneSummary(laneId, { tonnes = 18 } = {}) {
  const l = lane(laneId);
  let km = 0, movingH = 0, dwellH = 0, costUsd = 0, co2Kg = 0;
  const modes = new Set();

  for (const leg of l.legs) {
    const d = legDistanceKm(leg);
    const speed = legSpeed(leg);
    km += d;
    movingH += d / speed;
    dwellH += legDwellHours(leg);
    costUsd += d * (MODE_COST_PER_KM[leg.mode] ?? 1) + legFeesUsd(leg);
    co2Kg += d * tonnes * (MODE_CO2_PER_TONNE_KM[leg.mode] ?? 0.05);
    modes.add(leg.mode);
  }

  return {
    laneId,
    name: l.name,
    distanceKm: Math.round(km),
    movingHours: Number(movingH.toFixed(1)),
    dwellHours: Number(dwellH.toFixed(1)),
    transitHours: Number((movingH + dwellH).toFixed(1)),
    costUsd: Math.round(costUsd),
    co2Kg: Math.round(co2Kg),
    modes: [...modes],
    multiModal: modes.size > 1,
    legs: l.legs.length,
  };
}

/**
 * Graph edges for the router: one edge per leg of every lane, keyed by the
 * nodes it connects. The router searches these, so alternatives come out of
 * the same geography the map draws.
 */
function graphEdges({ tonnes = 18 } = {}) {
  const edges = [];
  for (const l of LANES) {
    for (const leg of l.legs) {
      const km = legDistanceKm(leg);
      const hours = km / legSpeed(leg) + legDwellHours(leg);
      edges.push({
        from: leg.from,
        to: leg.to,
        via: leg.via ?? [],
        mode: leg.mode,
        laneId: l.id,
        distanceKm: Math.round(km),
        hours: Number(hours.toFixed(2)),
        costUsd: Math.round(km * (MODE_COST_PER_KM[leg.mode] ?? 1) + legFeesUsd(leg)),
        co2Kg: Math.round(km * tonnes * (MODE_CO2_PER_TONNE_KM[leg.mode] ?? 0.05)),
        riskBase: Math.max(
          ...legNodeIds(leg).map((id) => node(id).riskBase ?? 0)
        ),
        coords: legCoords(leg),
      });
    }
  }
  return edges;
}

function listLanes() {
  return LANES.map((l) => l.id);
}

module.exports = {
  NODES,
  LANES,
  MODE_SPEED_KMH,
  MODE_COST_PER_KM,
  MODE_CO2_PER_TONNE_KM,
  node,
  coordsOf,
  lane,
  laneCoords,
  laneSummary,
  legDistanceKm,
  legDwellHours,
  legCoords,
  graphEdges,
  listLanes,
};
