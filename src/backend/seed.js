/**
 * seed.js — build the demo world.
 *
 * Everything written here is relative to the moment you run it, so ETAs never
 * rot. The old seed wrote absolute dates; three hours later every alert read
 * "PAST intervention window" and re-seeding became a pre-demo ritual.
 *
 *   npm run seed              default world, seed 42
 *   SEED=7 npm run seed       a different but equally reproducible world
 */
"use strict";
require("dotenv").config();

const mongoose = require("mongoose");
const { connectStore } = require("./store");

const Shipment = require("./models/Shipment");
const FleetAsset = require("./models/FleetAsset");
const RuleProfile = require("./models/RuleProfile");
const SensorLog = require("./models/SensorLog");
const Excursion = require("./models/Excursion");
const Alert = require("./models/Alert");
const Recommendation = require("./models/Recommendation");
const Disruption = require("./models/Disruption");
const RouteLeg = require("./models/RouteLeg");
const AuditEvent = require("./models/AuditEvent");

const { buildWorld } = require("./data/generate");
const net = require("./data/network");
const profileFile = require("./data/rule-profiles.json");

async function seed() {
  const store = await connectStore();
  if (store.mode === "none") {
    console.error("✖ No database available — start MongoDB, or set ENABLE_MEMORY_DB=1");
    process.exit(1);
  }

  const nowMs = Date.now();
  const seedNum = Number(process.env.SEED) || 42;

  console.log(`\n🌱 Seeding LIFECLOCK world (seed ${seedNum}, relative to now)\n`);

  // ── Wipe ──────────────────────────────────────────────────────────────────
  await Promise.all([
    Shipment.deleteMany({}),
    FleetAsset.deleteMany({}),
    RuleProfile.deleteMany({}),
    SensorLog.deleteMany({}),
    Excursion.deleteMany({}),
    Alert.deleteMany({}),
    Recommendation.deleteMany({}),
    Disruption.deleteMany({}),
    RouteLeg.deleteMany({}),
    AuditEvent.deleteMany({}),
  ]);
  console.log("   cleared 10 collections");

  // ── Rule profiles ─────────────────────────────────────────────────────────
  const profiles = await RuleProfile.insertMany(profileFile.profiles);
  const profileByKey = Object.fromEntries(profiles.map((p) => [p.profileKey, p]));
  const verified = profiles.filter((p) => p.confidence === "verified").length;
  console.log(`   ${profiles.length} rule profiles (${verified} with verified headline numbers)`);

  // ── Shipments and fleet ───────────────────────────────────────────────────
  const world = buildWorld({ nowMs, seed: seedNum });

  const shipmentDocs = world.shipments.map((s) => {
    const profile = profileByKey[s.profileKey];
    return {
      shipmentId: s.shipmentId,
      cargoType: s.cargoType,
      cargoValue: s.declaredValueUsd,
      declaredValueUsd: s.declaredValueUsd,
      doses: s.doses ?? undefined,
      priority: s.priority,
      origin: s.origin,
      destination: s.destination,
      currentLocation: { lat: s.routeCoords[0][1], lng: s.routeCoords[0][0] },
      status: "In Transit",
      eta: new Date(s.plannedEtaMs),
      needByAt: new Date(s.needByAtMs),
      deliveryDeadline: new Date(s.needByAtMs),
      carrier: s.carrier,
      tempProfileId: profile?._id,
      routeCoords: s.routeCoords,
      speedKmh: s.speedKmh,
      departedAt: new Date(s.departedAtMs),
      dwellHours: s.dwellHours,
      setpointC: profile?.setpointC ?? 5,
      corridorBiasC: s.corridorBiasC,
      transportMode: s.transportMode,
      riskScore: 0,
      riskDrivers: [],
    };
  });
  const createdShipments = await Shipment.insertMany(shipmentDocs);
  const shipmentIdByKey = Object.fromEntries(createdShipments.map((d) => [d.shipmentId, d._id]));

  // One RouteLeg per lane leg, so multi-leg shipments have real legs to cascade
  // through rather than the single leg the old seed wrote.
  let legCount = 0;
  for (const s of world.shipments) {
    const lane = net.lane(s.laneId);
    const docs = lane.legs.map((leg, i) => ({
      shipmentId: shipmentIdByKey[s.shipmentId],
      sequenceNo: i + 1,
      mode: leg.mode,
      carrier: s.carrier,
      origin: net.node(leg.from).name,
      destination: net.node(leg.to).name,
      startLocation: { lat: net.coordsOf(leg.from)[1], lng: net.coordsOf(leg.from)[0] },
      endLocation: { lat: net.coordsOf(leg.to)[1], lng: net.coordsOf(leg.to)[0] },
      status: "Pending",
    }));
    const created = await RouteLeg.insertMany(docs);
    legCount += created.length;
    await Shipment.updateOne({ shipmentId: s.shipmentId }, { $set: { routeLegs: created.map((d) => d._id) } });
  }

  const assetDocs = world.assets.map((a) => ({
    ...a,
    locationName: net.node(a.homeBase).name,
  }));
  await FleetAsset.insertMany(assetDocs);

  // ── Report ────────────────────────────────────────────────────────────────
  const idle = world.assets.filter((a) => a.status === "Idle").length;
  const lanes = new Set(world.shipments.map((s) => s.laneId));
  const vaccines = world.shipments.filter((s) => s.cargoType === "Vaccine").length;
  const doses = world.shipments.reduce((n, s) => n + (s.doses ?? 0), 0);
  const value = world.shipments.reduce((n, s) => n + s.declaredValueUsd, 0);

  console.log(`   ${world.shipments.length} shipments across ${lanes.size} lanes (${vaccines} cold-chain)`);
  console.log(`   ${legCount} route legs`);
  console.log(`   ${world.assets.length} fleet assets (${idle} idle)`);
  console.log(`   ${world.carriers.length} carriers`);
  console.log("");
  console.log(`   ${doses.toLocaleString()} doses in transit, $${(value / 1e6).toFixed(1)}M declared value`);
  console.log(`   hero: VX-2291, 240,000 doses, Pune -> Nairobi, ${net.laneSummary("IN-KE-SEA").transitHours} h lane`);
  console.log("");
  console.log("   Every timestamp is relative to now — this world does not go stale.");
  console.log("✅ Seed complete\n");

  await mongoose.connection.close();
}

seed().catch(async (err) => {
  console.error("✖ Seed failed:", err.message);
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(1);
});
