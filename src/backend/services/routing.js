/**
 * services/routing.js — real alternatives for a shipment in trouble.
 *
 * Replaces the string-matching cascade that produced things like
 * "Shanghai → Los Angeles" as BOTH the blocked route and the recommended fix,
 * with "no extra cost, 0h faster". It did that because it matched on location
 * names it recognised and fell through to a no-op for everything else.
 *
 * This walks the actual lane graph, penalises nodes the disruption has closed
 * or delayed, and returns options that differ from each other — including the
 * ones that are cheaper but arrive too late for the cargo, marked infeasible
 * with the shortfall, because "we considered this and here is why it lost" is
 * the part a dispatcher needs.
 */
"use strict";

const net = require("../data/network");
const { kShortestPaths } = require("../engines/graphRouter");
const { landedCost } = require("../engines/landedCost");
const clockEngine = require("../engines/viabilityClock");

const H = 3.6e6;

/** Nearest known node to a lat/lng, so a shipment mid-ocean still has a start. */
function nearestNode(coords) {
  if (!coords) return null;
  const { haversineKm } = require("../engines/motion");
  let best = null;
  let bestKm = Infinity;
  for (const [id, n] of Object.entries(net.NODES)) {
    const km = haversineKm(coords, n.coords);
    if (km < bestKm) { bestKm = km; best = id; }
  }
  return best;
}

/** Match a disruption to the nodes it closes or slows. */
function affectedNodes(disruption) {
  const blocked = new Set();
  const delayed = new Map();
  if (!disruption) return { blocked, delayed };

  const g = disruption.geometry ?? {};
  const centre = g.lng != null && g.lat != null ? [g.lng, g.lat] : null;
  const radiusKm = g.radius ?? 80;
  const { haversineKm } = require("../engines/motion");

  for (const [id, n] of Object.entries(net.NODES)) {
    const nameHit =
      g.locationName &&
      n.name.toLowerCase().includes(String(g.locationName).toLowerCase().split(",")[0].trim());
    const geoHit = centre ? haversineKm(centre, n.coords) <= radiusKm : false;
    if (!nameHit && !geoHit) continue;

    // A strike closes a port outright; weather slows it down.
    if (disruption.type === "Strike" || disruption.type === "Geopolitical") blocked.add(id);
    else delayed.set(id, disruption.type === "Weather" ? 36 : 18);
  }
  return { blocked, delayed };
}

/**
 * Build ranked options for one shipment.
 *
 * @returns {{options: Array, blockedNodes: string[], from: string, to: string}}
 */
function optionsFor({ shipment, profile, clock, disruption, carriers = [], nowMs }) {
  const from =
    nearestNode(
      shipment.currentLocation
        ? [shipment.currentLocation.lng, shipment.currentLocation.lat]
        : null
    ) ?? null;
  const toNode =
    Object.entries(net.NODES).find(([, n]) => n.name === shipment.destination)?.[0] ??
    nearestNode(
      Array.isArray(shipment.routeCoords) ? shipment.routeCoords[shipment.routeCoords.length - 1] : null
    );

  if (!from || !toNode || from === toNode) {
    return { options: [], blockedNodes: [], from, to: toNode };
  }

  const { blocked, delayed } = affectedNodes(disruption);

  // You cannot "route around" the place you are standing. If the disruption
  // closes the shipment's own position, treat it as a delay to get out rather
  // than a wall, otherwise the graph search finds nothing and every option
  // comes back infeasible.
  if (blocked.has(from)) {
    blocked.delete(from);
    delayed.set(from, Math.max(delayed.get(from) ?? 0, 48));
  }
  const edges = net.graphEdges();

  // What the shipment would do if nothing changed, with the delay applied.
  const plannedEtaMs = shipment.eta ? new Date(shipment.eta).getTime() : nowMs + 48 * H;
  const delayH = [...delayed.values()].reduce((a, b) => a + b, 0) || (blocked.size ? 96 : 0);

  const paths = kShortestPaths(edges, from, toNode, 3, {
    blockedNodes: blocked,
    nodeDelayH: delayed,
  });

  const needByAtMs = shipment.needByAt
    ? new Date(shipment.needByAt).getTime()
    : plannedEtaMs + 48 * H;

  const options = [];

  const judge = (etaMs) => {
    if (!clock || !profile) return { feasible: true, lifeClockAtDeliveryH: null, reason: null };
    return clockEngine.feasibility({
      needByAtMs,
      option: { etaMs, expectedOutOfRangeH: {} },
      clock,
      profile,
    });
  };

  // 1. Carry on regardless — priced honestly.
  const doNothingEta = plannedEtaMs + delayH * H;
  const dnVerdict = judge(doNothingEta);
  options.push({
    kind: "do_nothing",
    route: `${net.node(from).name} → ${net.node(toNode).name} (current plan)`,
    via: [],
    modes: [],
    costDelta: 0,
    timeDeltaHours: Math.round(delayH),
    riskScore: Math.min(100, 40 + delayH),
    etaMs: doNothingEta,
    feasible: dnVerdict.feasible,
    lifeClockAtDeliveryH: dnVerdict.lifeClockAtDeliveryH,
    infeasibleBecause: dnVerdict.feasible
      ? null
      : dnVerdict.reason === "schedule"
        ? "arrives after the deadline"
        : "cargo runs out of stability before it lands",
    rationale:
      delayH > 0
        ? `Absorbs the full ${Math.round(delayH)} h delay from the disruption.`
        : "No change to the plan.",
  });

  // 2. Real alternatives through the graph.
  const baseHours = (plannedEtaMs - nowMs) / H;
  for (const [i, p] of paths.entries()) {
    const etaMs = nowMs + p.summary.hours * H;
    const verdict = judge(etaMs);
    const cost = landedCost({
      freightUsd: p.summary.costUsd,
      transitHours: p.summary.hours,
      nodes: p.nodes,
      nodeTable: net.NODES,
      cargoType: shipment.cargoType,
      destinationCountry: net.node(toNode).country,
      declaredValueUsd: shipment.declaredValueUsd ?? shipment.cargoValue ?? 0,
      pLoss: verdict.feasible ? 0 : 1,
    });

    options.push({
      kind: i === 0 ? "reroute_primary" : "reroute_alternate",
      route: p.nodes.map((n) => net.node(n).name).join(" → "),
      via: p.nodes.slice(1, -1).map((n) => net.node(n).name),
      modes: p.summary.modes,
      distanceKm: p.summary.distanceKm,
      costDelta: Math.round(cost.totalUsd),
      costBreakdown: cost.breakdown,
      co2Kg: p.summary.co2Kg,
      timeDeltaHours: Math.round(p.summary.hours - baseHours),
      riskScore: Math.max(5, Math.round(p.summary.riskBase || 12)),
      etaMs,
      feasible: verdict.feasible,
      lifeClockAtDeliveryH: verdict.lifeClockAtDeliveryH,
      infeasibleBecause: verdict.feasible
        ? null
        : verdict.reason === "schedule"
          ? "arrives after the deadline"
          : "cargo runs out of stability before it lands",
      rationale:
        `${p.summary.distanceKm} km, ${p.summary.hours.toFixed(0)} h, ` +
        `${p.summary.modes.join(" + ")}${p.summary.multiModal ? " (multi-modal)" : ""}. ` +
        (verdict.feasible
          ? `Lands with ${verdict.lifeClockAtDeliveryH?.toFixed(1) ?? "?"} h of cargo life to spare.`
          : "Rejected: the cargo does not survive this routing."),
    });
  }

  // 3. A better carrier on the same lane, if one exists.
  // Offer a carrier that can actually serve this leg — an air carrier is not
  // an alternative for a road movement, however good its on-time record.
  const mode = shipment.transportMode ?? "Road";
  const servesMode = (c) =>
    mode === "Air" ? c.ratePerKm > 4 : mode === "Sea" ? c.ratePerKm < 1 : c.ratePerKm >= 1 && c.ratePerKm <= 4;

  const current = carriers.find((c) => c.code === shipment.carrier);
  const better = carriers
    .filter((c) => c.code !== shipment.carrier && servesMode(c) && c.onTimePct > (current?.onTimePct ?? 0))
    .sort((a, b) => b.onTimePct - a.onTimePct)[0];
  if (better) {
    const saveH = Math.max(1, baseHours * 0.08);
    const etaMs = plannedEtaMs - saveH * H;
    const verdict = judge(etaMs);
    options.push({
      kind: "switch_carrier",
      route: `${net.node(from).name} → ${net.node(toNode).name} via ${better.name}`,
      via: [],
      modes: [],
      carrier: better.code,
      costDelta: Math.round((shipment.declaredValueUsd ?? 0) * 0.004),
      timeDeltaHours: -Math.round(saveH),
      riskScore: Math.max(5, 100 - better.onTimePct),
      etaMs,
      feasible: verdict.feasible,
      lifeClockAtDeliveryH: verdict.lifeClockAtDeliveryH,
      infeasibleBecause: null,
      rationale:
        `${better.name}: ${better.onTimePct}% on time vs ${current?.onTimePct ?? "—"}%` +
        `${better.gdpCertified ? ", GDP certified" : ""}${better.ceivPharma ? ", IATA CEIV Pharma" : ""}.`,
    });
  }

  // Feasible first, then by how much cargo life each one leaves behind.
  options.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return (b.lifeClockAtDeliveryH ?? 0) - (a.lifeClockAtDeliveryH ?? 0);
  });

  return { options, blockedNodes: [...blocked], from, to: toNode };
}

module.exports = { optionsFor, affectedNodes, nearestNode };
