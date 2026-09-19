/**
 * disruptionGeometry.js — does this disruption threaten this shipment?
 *
 * The old impact engine tested three points per leg: the shipment's current
 * position and each leg's two endpoints. That misses a corridor running
 * straight through a storm whose endpoints are both clear, and it cannot tell
 * "already past it" from "heading into it" — which is why the Chicago scenario
 * flagged a shipment and then advised "no active disruptions, continue".
 *
 * Here the test is against the REMAINING path, segment by segment, and the
 * answer carries when the shipment reaches the zone.
 *
 * PURE: no database, no network, no clock.
 */
"use strict";

const { haversineKm } = require("./motion");

/**
 * Shortest distance in km from a point to a great-circle segment, approximated
 * by projecting onto the segment in a local flat frame. Good to a few hundred
 * metres at the scale we care about and far cheaper than a proper geodesic.
 */
function projectOnSegment(p, a, b) {
  const latRef = (a[1] + b[1]) / 2;
  const kx = Math.cos((latRef * Math.PI) / 180) * 111.32;
  const ky = 110.57;
  const ax = a[0] * kx, ay = a[1] * ky;
  const bx = b[0] * kx, by = b[1] * ky;
  const px = p[0] * kx, py = p[1] * ky;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { t: 0, distKm: Math.hypot(px - ax, py - ay) };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { t, distKm: Math.hypot(px - cx, py - cy) };
}

function pointToSegmentKm(p, a, b) {
  const latRef = (a[1] + b[1]) / 2;
  const kx = Math.cos((latRef * Math.PI) / 180) * 111.32; // km per degree lng
  const ky = 110.57;                                       // km per degree lat

  const ax = a[0] * kx, ay = a[1] * ky;
  const bx = b[0] * kx, by = b[1] * ky;
  const px = p[0] * kx, py = p[1] * ky;

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversineKm(p, a);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Where along a path a disruption bites.
 *
 * @param {number[][]} path      remaining path, [[lng, lat], ...]
 * @param {number[]}   centre    disruption centre [lng, lat]
 * @param {number}     radiusKm
 * @returns {{intersects, closestKm, distanceAlongKm, exposure}}
 *          distanceAlongKm = how far along the remaining path the zone starts
 */
function pathIntersection(path, centre, radiusKm) {
  if (!Array.isArray(path) || path.length < 2) {
    return { intersects: false, closestKm: Infinity, distanceAlongKm: null, exposure: 0 };
  }

  let closestKm = Infinity;
  let distanceAlong = 0;
  let entryAlongKm = null;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segKm = haversineKm(a, b);
    const { t, distKm: d } = projectOnSegment(centre, a, b);

    if (d < closestKm) closestKm = d;
    if (d <= radiusKm && entryAlongKm === null) {
      // Entry is where the path first comes within the radius. Use the
      // projection parameter so this is a real distance along the route, not
      // just "somewhere on this segment" — the answer becomes the hours the
      // operator has before it bites.
      const nearestAlong = distanceAlong + t * segKm;
      const chordKm = Math.sqrt(Math.max(0, radiusKm * radiusKm - d * d));
      entryAlongKm = Math.max(0, nearestAlong - chordKm);
    }
    distanceAlong += segKm;
  }

  const intersects = closestKm <= radiusKm;
  // Exposure falls off with distance: dead centre is 100, the rim is 0.
  const exposure = intersects
    ? Math.round(Math.max(0, 100 - (closestKm / radiusKm) * 100))
    : 0;

  return { intersects, closestKm, distanceAlongKm: entryAlongKm, exposure };
}

/**
 * Full assessment for one shipment against one disruption.
 *
 * @returns {{
 *   impacted, relation, exposure, closestKm, hoursToZone, entryAtMs, reason
 * }}
 *   relation: "inside" | "approaching" | "past" | "clear"
 */
function assess({ remainingPath, currentPosition, speedKmh, nowMs, disruption }) {
  const centre = disruption.centre;
  const radiusKm = disruption.radiusKm ?? 50;

  // Already inside it?
  const distNowKm = currentPosition ? haversineKm(currentPosition, centre) : Infinity;
  if (distNowKm <= radiusKm) {
    return {
      impacted: true,
      relation: "inside",
      exposure: Math.round(Math.max(0, 100 - (distNowKm / radiusKm) * 100)),
      closestKm: distNowKm,
      hoursToZone: 0,
      entryAtMs: nowMs,
      reason: `inside the zone now (${distNowKm.toFixed(0)} km from centre)`,
    };
  }

  const hit = pathIntersection(remainingPath, centre, radiusKm);

  if (!hit.intersects) {
    // Nothing ahead. If the shipment is near the zone but the remaining path
    // misses it, it has already gone by — say so rather than flagging it.
    const relation = distNowKm < radiusKm * 3 ? "past" : "clear";
    return {
      impacted: false,
      relation,
      exposure: 0,
      closestKm: Math.min(distNowKm, hit.closestKm),
      hoursToZone: null,
      entryAtMs: null,
      reason:
        relation === "past"
          ? "the remaining route does not re-enter the zone — already past it"
          : "route does not pass through the zone",
    };
  }

  const hoursToZone = speedKmh > 0 && hit.distanceAlongKm !== null
    ? hit.distanceAlongKm / speedKmh
    : null;

  return {
    impacted: true,
    relation: "approaching",
    exposure: hit.exposure,
    closestKm: hit.closestKm,
    hoursToZone,
    entryAtMs: hoursToZone !== null ? nowMs + hoursToZone * 3.6e6 : null,
    reason:
      hoursToZone !== null
        ? `enters the zone in ${hoursToZone.toFixed(1)} h (${hit.distanceAlongKm.toFixed(0)} km ahead)`
        : "route passes through the zone",
  };
}

/** Does a tariff-shock style disruption apply? It has no geography. */
function appliesNonGeographic({ disruption, shipment, nowMs }) {
  if (disruption.type !== "Tariff") return false;
  const effectiveFrom = disruption.effectiveFromMs ?? 0;
  const arrivesAt = shipment.etaMs ?? Infinity;
  const countryMatches =
    !disruption.destinationCountry || disruption.destinationCountry === shipment.destinationCountry;
  const productMatches =
    !disruption.productCategory || disruption.productCategory === shipment.cargoType;
  return countryMatches && productMatches && arrivesAt >= effectiveFrom;
}

module.exports = { pointToSegmentKm, projectOnSegment, pathIntersection, assess, appliesNonGeographic };
