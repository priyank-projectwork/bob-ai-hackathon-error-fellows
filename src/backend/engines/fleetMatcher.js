/**
 * fleetMatcher.js — which idle asset should rescue this shipment?
 *
 * The previous version scored every pair NEGATIVE. Proximity saturated at zero
 * beyond 100 km while a linear deadhead penalty kept growing, so on the seeded
 * data the best score was -14 and the worst -517, and the "winner" was simply
 * the least negative. It also had no concept of mode, so a reefer truck could
 * be dispatched to a container vessel 1,800 km out in the Pacific.
 *
 * This version:
 *   - hard filters first (mode, temperature range, capacity, availability)
 *   - scores 0-100 from named, explainable factors
 *   - measures distance to the PICKUP POINT, not the shipment's current
 *     position, because that is where the asset actually has to be
 *   - adds pre-cool time to the rescue ETA, so a reefer that needs four hours
 *     to come down to temperature cannot pretend to arrive instantly
 *   - refuses to return anything below a floor, rather than proposing nonsense
 *
 * PURE: no database, no network, no clock.
 */
"use strict";

const { haversineKm } = require("./motion");

/** Weights sum to 1.0. Every one is used — none are declared and ignored. */
const WEIGHTS = {
  proximity: 0.35,
  capability: 0.20,
  capacity: 0.15,
  availability: 0.15,
  health: 0.10,
  cost: 0.05,
};

/** Below this, no asset is proposed. Better to say "none suitable". */
const MIN_SCORE = 35;

/** Distance beyond which proximity scores zero. [illustrative] */
const PROXIMITY_HORIZON_KM = 1500;

/**
 * @param {object} shipment { cargoType, tonnes, minTempC, maxTempC, transportMode,
 *                            pickupPoint: [lng, lat], pickupByMs }
 * @param {Array}  assets
 * @param {object} opts     { nowMs }
 * @returns {{matches: Array, rejected: Array}} best first, with reasons for both
 */
function rankFleetMatches(shipment, assets, { nowMs = 0 } = {}) {
  const matches = [];
  const rejected = [];

  for (const asset of assets ?? []) {
    const reject = (reason) => rejected.push({ assetId: asset.assetId, reason });

    // ── Hard filters ──────────────────────────────────────────────────────
    if (asset.status !== "Idle") { reject(`status is ${asset.status}`); continue; }

    const needMode = shipment.transportMode ?? "Road";
    const assetModes = asset.modes ?? ["Road"];
    if (!assetModes.includes(needMode)) {
      reject(`cannot serve a ${needMode} leg (${assetModes.join("/")} only)`);
      continue;
    }

    if (shipment.minTempC != null && shipment.maxTempC != null) {
      const canHold = asset.minTempC <= shipment.minTempC && asset.maxTempC >= shipment.maxTempC;
      if (!canHold) { reject(`cannot hold ${shipment.minTempC}-${shipment.maxTempC} C`); continue; }
    }

    const needKg = shipment.tonnes ? shipment.tonnes * 1000 : 0;
    if (needKg && asset.capacityWeight < needKg) {
      reject(`capacity ${asset.capacityWeight} kg < ${needKg} kg required`);
      continue;
    }

    if (asset.unitHealth === "fault") { reject("unit is faulted"); continue; }

    // ── Distance to the PICKUP point ──────────────────────────────────────
    const assetPos = asset.currentLocation
      ? [asset.currentLocation.lng, asset.currentLocation.lat]
      : null;
    const pickup = shipment.pickupPoint ?? null;
    const distanceKm = assetPos && pickup ? haversineKm(assetPos, pickup) : null;

    // ── Can it physically get there in time? ──────────────────────────────
    const speedKmh = asset.speedKmh ?? (needMode === "Air" ? 800 : needMode === "Sea" ? 35 : 80);
    const preCoolH = asset.preCoolHours ?? 0;
    const driveH = distanceKm != null ? distanceKm / speedKmh : null;
    const readyInH = driveH != null ? preCoolH + driveH : null;

    if (shipment.pickupByMs && readyInH != null) {
      const availableH = (shipment.pickupByMs - nowMs) / 3.6e6;
      if (readyInH > availableH) {
        reject(`needs ${readyInH.toFixed(1)} h (incl. ${preCoolH} h pre-cool), only ${availableH.toFixed(1)} h available`);
        continue;
      }
    }

    if (needMode === "Road" && asset.driverHoursRemaining != null && driveH != null) {
      if (asset.driverHoursRemaining < driveH) {
        reject(`driver has ${asset.driverHoursRemaining} h left, drive is ${driveH.toFixed(1)} h`);
        continue;
      }
    }

    if (asset.maintenanceDueMs != null && readyInH != null) {
      if (asset.maintenanceDueMs < nowMs + readyInH * 3.6e6) {
        reject("maintenance falls due before it could finish the job");
        continue;
      }
    }

    // ── Scores, each 0-100 ────────────────────────────────────────────────
    const proximity = distanceKm == null
      ? 50
      : Math.max(0, 100 * (1 - distanceKm / PROXIMITY_HORIZON_KM));

    const capability = shipment.minTempC == null
      ? 70
      : Math.min(100, 60 + ((shipment.minTempC - asset.minTempC) + (asset.maxTempC - shipment.maxTempC)) * 2);

    const capacity = needKg
      ? Math.min(100, 50 + (asset.capacityWeight / needKg) * 25)
      : 70;

    let availability = 100;
    if (asset.driverHoursRemaining != null && driveH != null) {
      const slack = asset.driverHoursRemaining - driveH;
      if (slack < 2) availability -= 30;
      else if (slack < 4) availability -= 10;
    }
    if (preCoolH > 2) availability -= 10;
    availability = Math.max(0, availability);

    const health = asset.unitHealth === "ok" ? 100 : asset.unitHealth === "degraded" ? 45 : 0;

    const deployCost = (asset.costPerKmUsd ?? 1) * (distanceKm ?? 0);
    const cost = Math.max(0, 100 - deployCost / 40);

    const score = Math.round(
      WEIGHTS.proximity * proximity +
      WEIGHTS.capability * capability +
      WEIGHTS.capacity * capacity +
      WEIGHTS.availability * availability +
      WEIGHTS.health * health +
      WEIGHTS.cost * cost
    );

    if (score < MIN_SCORE) { reject(`score ${score} below the ${MIN_SCORE} floor`); continue; }

    matches.push({
      assetId: asset.assetId,
      asset,
      matchScore: score,
      distanceKm: distanceKm == null ? null : Math.round(distanceKm),
      deadheadUsd: Math.round(deployCost),
      preCoolHours: preCoolH,
      etaHours: readyInH == null ? null : Number(readyInH.toFixed(1)),
      idleHours: asset.idleSinceMs ? Number(((nowMs - asset.idleSinceMs) / 3.6e6).toFixed(1)) : null,
      factors: {
        proximity: Math.round(proximity),
        capability: Math.round(capability),
        capacity: Math.round(capacity),
        availability: Math.round(availability),
        health: Math.round(health),
        cost: Math.round(cost),
      },
      why:
        `${Math.round(distanceKm ?? 0)} km from pickup, ready in ` +
        `${readyInH == null ? "-" : readyInH.toFixed(1)} h (incl. ${preCoolH} h pre-cool), ` +
        `unit ${asset.unitHealth ?? "ok"}.`,
    });
  }

  matches.sort((a, b) => b.matchScore - a.matchScore);
  return { matches, rejected };
}

/**
 * Assign assets across several shipments at once.
 *
 * Matching each shipment independently double-books: the nearest truck wins
 * every comparison and the second shipment gets whatever is left. This walks
 * the highest-scoring pairs globally and consumes each asset once.
 */
function assignFleet(shipments, assets, { nowMs = 0 } = {}) {
  const pairs = [];
  for (const s of shipments) {
    const { matches } = rankFleetMatches(s, assets, { nowMs });
    for (const m of matches) pairs.push({ shipmentId: s.shipmentId, ...m });
  }
  pairs.sort((a, b) => b.matchScore - a.matchScore);

  const takenAssets = new Set();
  const served = new Set();
  const assignments = [];

  for (const p of pairs) {
    if (takenAssets.has(p.assetId) || served.has(p.shipmentId)) continue;
    takenAssets.add(p.assetId);
    served.add(p.shipmentId);
    assignments.push(p);
  }

  return {
    assignments,
    unserved: shipments.filter((s) => !served.has(s.shipmentId)).map((s) => s.shipmentId),
  };
}

/** Fleet utilisation — the other half of the problem statement. */
function utilisation(assets, { nowMs = 0, windowH = 168 } = {}) {
  const total = assets.length || 1;
  const idle = assets.filter((a) => a.status === "Idle");
  const working = assets.filter((a) => a.status === "Assigned" || a.status === "Active");
  const maintenance = assets.filter((a) => a.status === "Maintenance");

  const idleHoursOf = (a) =>
    a.idleSinceMs ? Math.min(windowH, Math.max(0, (nowMs - a.idleSinceMs) / 3.6e6)) : 0;

  const idleHours = idle.reduce((s, a) => s + idleHoursOf(a), 0);
  const idleCostUsd = idle.reduce((s, a) => s + idleHoursOf(a) * (a.costPerIdleHourUsd ?? 0), 0);

  const byBase = {};
  for (const a of assets) {
    const base = a.homeBase ?? "unknown";
    byBase[base] = byBase[base] ?? { total: 0, idle: 0 };
    byBase[base].total += 1;
    if (a.status === "Idle") byBase[base].idle += 1;
  }

  return {
    totalAssets: assets.length,
    idle: idle.length,
    working: working.length,
    maintenance: maintenance.length,
    utilisationPct: Math.round((working.length / total) * 100),
    idleHours: Math.round(idleHours),
    idleCostUsd: Math.round(idleCostUsd),
    longestIdle: idle
      .map((a) => ({ assetId: a.assetId, hours: Math.round(idleHoursOf(a)) }))
      .sort((x, y) => y.hours - x.hours)
      .slice(0, 5),
    byBase,
  };
}

module.exports = { rankFleetMatches, assignFleet, utilisation, WEIGHTS, MIN_SCORE, PROXIMITY_HORIZON_KM };
