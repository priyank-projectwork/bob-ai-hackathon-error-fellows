/**
 * data/generate.js — builds the seed world from the lane network.
 *
 * Two rules this module exists to enforce:
 *
 *  1. **Everything is relative.** Times are offsets from a `nowMs` the caller
 *     passes in, never absolute dates. The old seed wrote fixed ETAs, so three
 *     hours after seeding every alert read "PAST intervention window" and the
 *     demo quietly rotted. Re-seeding is no longer a pre-demo ritual.
 *
 *  2. **Deterministic.** Everything random comes from a seeded generator, so
 *     the same seed builds the same world — which is what makes a recording
 *     reproducible rather than a lucky take.
 *
 * PURE: no database, no clock. The caller supplies nowMs and writes the result.
 */
"use strict";

const net = require("./network");
const { seededRng } = require("../sim/telemetryGen");

const H = 3.6e6;

/** Lanes shipments are generated on, with the cargo that plausibly moves there. */
const LANE_MIX = [
  { laneId: "IN-KE-SEA", count: 4, cargo: "Vaccine", profile: "mrna_comirnaty_thawed", mode: "Sea" },
  { laneId: "IN-KE-AIR", count: 2, cargo: "Vaccine", profile: "mrna_comirnaty_thawed", mode: "Air" },
  { laneId: "IN-NL-SUEZ", count: 4, cargo: "Vaccine", profile: "vaccine_2_8_freeze_sensitive", mode: "Sea" },
  { laneId: "IN-AE", count: 3, cargo: "Perishable", profile: "produce_banana", mode: "Sea" },
  { laneId: "CN-US-PAC", count: 4, cargo: "Standard", profile: "frozen_minus20", mode: "Sea" },
  { laneId: "US-LAX-DEN", count: 4, cargo: "Vaccine", profile: "vaccine_2_8_freeze_sensitive", mode: "Road" },
  { laneId: "US-LAX-ABQ", count: 3, cargo: "Vaccine", profile: "mrna_spikevax_thawed", mode: "Road" },
  { laneId: "US-ELP-DEN", count: 3, cargo: "Standard", profile: "frozen_minus20", mode: "Road" },
  { laneId: "US-ORD-DEN", count: 4, cargo: "Vaccine", profile: "vaccine_2_8_freeze_sensitive", mode: "Road" },
  { laneId: "US-CLE-ORD", count: 3, cargo: "Perishable", profile: "produce_banana", mode: "Road" },
  { laneId: "US-GNV-ATL", count: 3, cargo: "Perishable", profile: "produce_banana", mode: "Road" },
  { laneId: "US-MIA-ATL", count: 3, cargo: "Vaccine", profile: "mrna_spikevax_thawed", mode: "Road" },
  { laneId: "US-BR-SEA", count: 3, cargo: "Standard", profile: "frozen_minus20", mode: "Sea" },
];

const CARRIERS = [
  { code: "MAEU", name: "Maersk Line", onTimePct: 84, gdpCertified: true, ceivPharma: true, ratePerKm: 0.095 },
  { code: "MSCU", name: "MSC", onTimePct: 79, gdpCertified: true, ceivPharma: false, ratePerKm: 0.088 },
  { code: "CMAU", name: "CMA CGM", onTimePct: 81, gdpCertified: true, ceivPharma: true, ratePerKm: 0.092 },
  { code: "EKAI", name: "Emirates SkyCargo", onTimePct: 91, gdpCertified: true, ceivPharma: true, ratePerKm: 4.30 },
  { code: "QRAI", name: "Qatar Airways Cargo", onTimePct: 89, gdpCertified: true, ceivPharma: true, ratePerKm: 4.55 },
  { code: "SWFT", name: "Swift Cold Logistics", onTimePct: 76, gdpCertified: false, ceivPharma: false, ratePerKm: 1.72 },
  { code: "PRME", name: "Prime Reefer Haulage", onTimePct: 88, gdpCertified: true, ceivPharma: false, ratePerKm: 1.95 },
  { code: "KENF", name: "Kenfreight EA", onTimePct: 73, gdpCertified: false, ceivPharma: false, ratePerKm: 1.55 },
];

/** Depots assets idle at, roughly where the lanes are. */
const ASSET_BASES = [
  "PNQ", "INNSA", "AEJEA", "KEMBA", "NBO", "NAKURU", "NLRTM",
  "LAX", "SAN", "PHX", "DEN", "SLC", "ORD", "MCI", "ATL", "MIA", "SAO",
];

const ASSET_KINDS = [
  { type: "Reefer Truck", capacityKg: 22000, minC: -25, maxC: 25, preCoolH: 1.5, costPerIdleHourUsd: 18, costPerKmUsd: 1.85, modes: ["Road"] },
  { type: "Reefer Container", capacityKg: 26000, minC: -30, maxC: 30, preCoolH: 4, costPerIdleHourUsd: 9, costPerKmUsd: 0.09, modes: ["Sea", "Rail"] },
  { type: "Air ULD", capacityKg: 1500, minC: -20, maxC: 25, preCoolH: 2, costPerIdleHourUsd: 26, costPerKmUsd: 4.40, modes: ["Air"] },
  { type: "Vessel", capacityKg: 900000, minC: -30, maxC: 30, preCoolH: 0, costPerIdleHourUsd: 240, costPerKmUsd: 0.06, modes: ["Sea"] },
];

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Build the whole world.
 * @param {number} nowMs  the moment everything is relative to
 * @param {number} seed
 */
function buildWorld({ nowMs, seed = 42 }) {
  const rand = seededRng(seed);
  const shipments = [];
  const carriersByMode = {
    Sea: CARRIERS.filter((c) => c.ratePerKm < 1),
    Air: CARRIERS.filter((c) => c.ratePerKm > 4),
    Road: CARRIERS.filter((c) => c.ratePerKm >= 1 && c.ratePerKm <= 4),
  };

  let n = 0;
  for (const spec of LANE_MIX) {
    const summary = net.laneSummary(spec.laneId);
    const coords = net.laneCoords(spec.laneId);

    for (let i = 0; i < spec.count; i++) {
      n += 1;
      // Spread departures so the world is mid-flight, not all at the start line.
      const fractionDone = 0.08 + rand() * 0.72;
      const elapsedH = summary.transitHours * fractionDone;
      const departedAtMs = nowMs - elapsedH * H;
      const remainingH = summary.transitHours - elapsedH;

      // Deadline sits a little beyond the planned arrival, so most shipments
      // have slack and a few are tight. That spread is what the triage queue
      // has to sort.
      const slackH = 6 + rand() * 60;
      const needByAtMs = nowMs + (remainingH + slackH) * H;

      const doses = spec.cargo === "Vaccine" ? Math.round((40 + rand() * 260) * 1000) : null;
      const valueUsd = spec.cargo === "Vaccine"
        ? Math.round(180000 + rand() * 820000)
        : Math.round(20000 + rand() * 180000);

      const carrier = pick(rand, carriersByMode[spec.mode] ?? CARRIERS);

      shipments.push({
        shipmentId: `${spec.cargo === "Vaccine" ? "VX" : spec.cargo === "Perishable" ? "PR" : "GN"}-${2200 + n}`,
        laneId: spec.laneId,
        cargoType: spec.cargo,
        profileKey: spec.profile,
        transportMode: spec.mode,
        priority: rand() < 0.22 ? "Critical" : rand() < 0.55 ? "High" : "Medium",
        origin: net.node(net.lane(spec.laneId).legs[0].from).name,
        destination: net.node(net.lane(spec.laneId).legs.at(-1).to).name,
        routeCoords: coords,
        speedKmh: round(summary.distanceKm / Math.max(1, summary.movingHours), 1),
        dwellHours: summary.dwellHours,
        departedAtMs,
        needByAtMs,
        plannedEtaMs: nowMs + remainingH * H,
        setpointC: null, // filled from the profile at seed time
        corridorBiasC: spec.mode === "Sea" ? -1.5 : spec.mode === "Air" ? -4 : 0,
        carrier: carrier.code,
        doses,
        declaredValueUsd: valueUsd,
        status: "In Transit",
      });
    }
  }

  // ── The hero shipments, pinned so the scenario always has its cast ────────
  const heroLane = net.laneSummary("IN-KE-SEA");
  const heroCoords = net.laneCoords("IN-KE-SEA");
  const heroSpeed = round(heroLane.distanceKm / Math.max(1, heroLane.movingHours), 1);

  shipments.unshift({
    shipmentId: "VX-2291",
    laneId: "IN-KE-SEA",
    cargoType: "Vaccine",
    profileKey: "mrna_comirnaty_thawed",
    transportMode: "Sea",
    priority: "Critical",
    origin: "Pune",
    destination: "Nairobi national store",
    routeCoords: heroCoords,
    speedKmh: heroSpeed,
    dwellHours: heroLane.dwellHours,
    // Far enough along to be past Jebel Ali and approaching Mombasa.
    departedAtMs: nowMs - heroLane.transitHours * 0.62 * H,
    needByAtMs: nowMs + (heroLane.transitHours * 0.38 + 96) * H,
    plannedEtaMs: nowMs + heroLane.transitHours * 0.38 * H,
    setpointC: null,
    corridorBiasC: -1.5,
    carrier: "MAEU",
    doses: 240000,
    declaredValueUsd: 1_120_000,
    status: "In Transit",
    hero: true,
  });

  shipments.unshift({
    shipmentId: "VX-2304",
    laneId: "IN-KE-SEA",
    cargoType: "Vaccine",
    profileKey: "mrna_comirnaty_thawed",
    transportMode: "Sea",
    priority: "High",
    origin: "Pune",
    destination: "Nairobi national store",
    routeCoords: heroCoords,
    speedKmh: heroSpeed,
    dwellHours: heroLane.dwellHours,
    departedAtMs: nowMs - heroLane.transitHours * 0.48 * H,
    needByAtMs: nowMs + (heroLane.transitHours * 0.52 + 72) * H,
    plannedEtaMs: nowMs + heroLane.transitHours * 0.52 * H,
    setpointC: null,
    corridorBiasC: -1.5,
    carrier: "MSCU",
    doses: 96000,
    declaredValueUsd: 430_000,
    status: "In Transit",
    hero: true,
  });

  // ── Fleet ────────────────────────────────────────────────────────────────
  const assets = [];
  for (let i = 0; i < 40; i++) {
    const kind = i < 22 ? ASSET_KINDS[0] : i < 32 ? ASSET_KINDS[1] : i < 37 ? ASSET_KINDS[2] : ASSET_KINDS[3];
    const baseId = pick(rand, ASSET_BASES);
    const base = net.node(baseId);
    // Most idle, some already working, a couple in maintenance.
    const roll = rand();
    const status = roll < 0.58 ? "Idle" : roll < 0.9 ? "Assigned" : "Maintenance";
    const idleSinceH = status === "Idle" ? round(rand() * 96, 1) : 0;

    assets.push({
      assetId: `${kind.type.split(" ")[0].toUpperCase().slice(0, 4)}-${300 + i}`,
      type: kind.type,
      status,
      homeBase: baseId,
      currentLocation: { lat: base.coords[1], lng: base.coords[0] },
      capacityWeight: kind.capacityKg,
      coldChainCapable: true,
      minTempC: kind.minC,
      maxTempC: kind.maxC,
      preCoolHours: kind.preCoolH,
      modes: kind.modes,
      costPerIdleHourUsd: kind.costPerIdleHourUsd,
      costPerKmUsd: kind.costPerKmUsd,
      idleSinceMs: status === "Idle" ? nowMs - idleSinceH * H : null,
      driverHoursRemaining: kind.modes.includes("Road") ? round(2 + rand() * 9, 1) : null,
      maintenanceDueMs: nowMs + (rand() * 800 - 100) * H,
      unitHealth: rand() < 0.08 ? "degraded" : "ok",
    });
  }

  // A reefer truck parked in Nairobi, idle and healthy, so the hero rescue has
  // a physically sensible candidate rather than whatever happens to rank first.
  assets.push({
    assetId: "REEF-341",
    type: "Reefer Truck",
    status: "Idle",
    homeBase: "NBO",
    currentLocation: { lat: net.node("NBO").coords[1], lng: net.node("NBO").coords[0] },
    capacityWeight: 22000,
    coldChainCapable: true,
    minTempC: -25,
    maxTempC: 25,
    preCoolHours: 1.5,
    modes: ["Road"],
    costPerIdleHourUsd: 18,
    costPerKmUsd: 1.85,
    idleSinceMs: nowMs - 52 * H,
    driverHoursRemaining: 9.5,
    maintenanceDueMs: nowMs + 600 * H,
    unitHealth: "ok",
  });

  return { shipments, assets, carriers: CARRIERS };
}

module.exports = { buildWorld, LANE_MIX, CARRIERS, ASSET_KINDS };
