/**
 * motion.js — where a shipment is, given a route and a moment in time.
 *
 * Routes are GeoJSON LineString coordinate arrays: [[lng, lat], ...].
 * Distances are great-circle (haversine) in km. Interpolation takes the short
 * way round the antimeridian, so a Shanghai -> Los Angeles leg crosses the
 * Pacific rather than running backwards across Eurasia.
 *
 * PURE: no database, no network, no wall-clock reads. Every entry point that
 * needs "now" takes nowMs.
 */
"use strict";

const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in km between two [lng, lat] points. */
function haversineKm(a, b) {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Normalise a longitude into [-180, 180). Used after interpolation so emitted
 * coordinates are always valid GeoJSON.
 */
function normaliseLng(lng) {
  let x = ((lng + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/**
 * Unwrap a polyline so consecutive longitudes never jump more than 180 degrees.
 * The result may contain longitudes outside [-180, 180]; that is intentional —
 * it lets us interpolate across the dateline. Re-normalise before emitting.
 */
function unwrap(coords) {
  if (coords.length === 0) return [];
  const out = [coords[0].slice()];
  for (let i = 1; i < coords.length; i++) {
    const prevLng = out[i - 1][0];
    let lng = coords[i][0];
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    out.push([lng, coords[i][1]]);
  }
  return out;
}

/**
 * Cumulative distance table for a route.
 * @returns {{coords: number[][], cum: number[], totalKm: number}}
 */
function measure(coords) {
  const unwrapped = unwrap(coords);
  const cum = [0];
  for (let i = 1; i < unwrapped.length; i++) {
    cum.push(cum[i - 1] + haversineKm(unwrapped[i - 1], unwrapped[i]));
  }
  return { coords: unwrapped, cum, totalKm: cum[cum.length - 1] ?? 0 };
}

/**
 * Point at a given distance along the route.
 * Clamps to the endpoints outside [0, totalKm].
 * @returns {{position: [number, number], segmentIndex: number, bearing: number}}
 */
function pointAtKm(coords, km) {
  const { coords: pts, cum, totalKm } = measure(coords);
  if (pts.length === 0) return { position: [0, 0], segmentIndex: 0, bearing: 0 };
  if (pts.length === 1) return { position: [normaliseLng(pts[0][0]), pts[0][1]], segmentIndex: 0, bearing: 0 };

  const d = Math.max(0, Math.min(km, totalKm));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;

  const segStart = pts[i - 1];
  const segEnd = pts[i];
  const segLen = cum[i] - cum[i - 1];
  const t = segLen === 0 ? 0 : (d - cum[i - 1]) / segLen;

  const lng = segStart[0] + (segEnd[0] - segStart[0]) * t;
  const lat = segStart[1] + (segEnd[1] - segStart[1]) * t;

  return {
    position: [normaliseLng(lng), lat],
    segmentIndex: i - 1,
    bearing: bearingDeg(segStart, segEnd),
  };
}

/** Initial bearing in degrees from a to b. */
function bearingDeg(a, b) {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Advance a shipment along its route.
 *
 * @param {object}   args
 * @param {number[][]} args.coords     route as [[lng, lat], ...]
 * @param {number}   args.departedAtMs when it started moving
 * @param {number}   args.nowMs        the simulated moment
 * @param {number}   args.speedKmh     mode speed
 * @param {number}  [args.dwellHours]  total planned dwell before now (ports, borders)
 * @param {boolean} [args.halted]      held in place (e.g. hold-at-depot)
 * @param {number}  [args.haltedAtKm]  distance along at the moment of halting
 * @returns {{position, progressKm, totalKm, fractionDone, remainingKm, etaMs, arrived, bearing}}
 */
function advance({ coords, departedAtMs, nowMs, speedKmh, dwellHours = 0, halted = false, haltedAtKm = null }) {
  const { totalKm } = measure(coords);
  const elapsedH = Math.max(0, (nowMs - departedAtMs) / 3.6e6);
  const movingH = Math.max(0, elapsedH - dwellHours);

  const progressKm = halted && haltedAtKm !== null
    ? Math.max(0, Math.min(haltedAtKm, totalKm))
    : Math.max(0, Math.min(movingH * speedKmh, totalKm));

  const { position, bearing } = pointAtKm(coords, progressKm);
  const remainingKm = Math.max(0, totalKm - progressKm);

  // A halted shipment has no arrival time until it moves again.
  const etaMs = halted
    ? null
    : nowMs + (speedKmh > 0 ? (remainingKm / speedKmh) * 3.6e6 : 0);

  return {
    position,
    progressKm,
    totalKm,
    fractionDone: totalKm === 0 ? 1 : progressKm / totalKm,
    remainingKm,
    etaMs,
    arrived: remainingKm <= 0.001,
    bearing,
  };
}

/**
 * The part of the route still ahead of the shipment. This is what impact
 * detection must test against — a disruption the shipment has already passed
 * is not a threat.
 */
function remainingPath({ coords, progressKm }) {
  const { coords: pts, cum, totalKm } = measure(coords);
  const d = Math.max(0, Math.min(progressKm, totalKm));
  const head = pointAtKm(coords, d).position;
  const rest = [];
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > d) rest.push([normaliseLng(pts[i][0]), pts[i][1]]);
  }
  return [head, ...rest];
}

module.exports = {
  haversineKm,
  measure,
  pointAtKm,
  advance,
  remainingPath,
  bearingDeg,
  normaliseLng,
  unwrap,
};
