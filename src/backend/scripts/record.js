#!/usr/bin/env node
/**
 * npm run record — drive the real world and engines, write the result.
 *
 * Nothing here decides a severity, a clock value or a disposition. It moves
 * the world forward, feeds each reading through the same pipeline the live
 * server uses, and writes down what the engines said. That is why the demo
 * can be replayed honestly: it IS the engine output.
 */
"use strict";
require("dotenv").config();

const mongoose = require("mongoose");
const { connectStore } = require("../store");
const { World } = require("../sim/world");
const { Recorder } = require("../sim/recorder");
const coldChain = require("../services/coldChain");

const Shipment = require("../models/Shipment");
const RuleProfile = require("../models/RuleProfile");
const { buildWorld } = require("../data/generate");
const scenario = require("../data/scenarios/in-ke.json");

const SIM_MINUTES = Number(process.env.RECORD_MINUTES) || 180;
const SEED = Number(process.env.SEED) || 42;

async function main() {
  const store = await connectStore();
  if (store.mode === "none") {
    console.error("✖ No database — start MongoDB or set ENABLE_MEMORY_DB=1");
    process.exit(1);
  }

  // Fresh, deterministic world.
  const nowMs = 1_700_000_000_000; // fixed epoch so the recording is reproducible
  await Promise.all([Shipment.deleteMany({}), RuleProfile.deleteMany({})]);
  const profiles = await RuleProfile.insertMany(require("../data/rule-profiles.json").profiles);
  const byKey = Object.fromEntries(profiles.map((p) => [p.profileKey, p]));
  const built = buildWorld({ nowMs, seed: SEED });

  await Shipment.insertMany(built.shipments.map((s) => ({
    shipmentId: s.shipmentId, cargoType: s.cargoType, priority: s.priority,
    origin: s.origin, destination: s.destination, status: "In Transit",
    currentLocation: { lat: s.routeCoords[0][1], lng: s.routeCoords[0][0] },
    eta: new Date(s.plannedEtaMs), needByAt: new Date(s.needByAtMs),
    carrier: s.carrier, tempProfileId: byKey[s.profileKey]?._id,
    routeCoords: s.routeCoords, speedKmh: s.speedKmh,
    departedAt: new Date(s.departedAtMs), dwellHours: s.dwellHours,
    setpointC: byKey[s.profileKey]?.setpointC ?? 5, corridorBiasC: s.corridorBiasC,
    transportMode: s.transportMode, declaredValueUsd: s.declaredValueUsd, doses: s.doses,
  })));

  const rec = new Recorder(scenario.id);
  const world = new World({ startMs: nowMs, speed: 1, seed: SEED, mode: "simulate" });

  world.configure({
    loadShipments: async () => {
      const docs = await Shipment.find({ status: "In Transit" }).lean();
      return docs.map((d) => ({
        ...d,
        departedAtMs: new Date(d.departedAt).getTime(),
        speedKmh: d.speedKmh || 80,
      }));
    },
    onReading: async (reading) => {
      const result = await coldChain.processReading(reading);
      rec.write("reading", {
        at: reading.recordedAt,
        shipmentId: reading.shipmentId,
        tempC: reading.temperatureCelsius,
        ambientC: reading.ambientC,
        unitMode: reading.unitMode,
        position: reading.position,
        // Engine output, written down — not invented at replay time.
        events: result?.events ?? [],
        severity: result?.excursion?.severity ?? null,
        lifeClockH: result?.clock ? Number(result.clock.lifeClockH.toFixed(2)) : null,
        state: result?.clock?.state ?? null,
        binding: result?.clock?.bindingConstraint ?? null,
        prediction: result?.prediction
          ? { tBreachH: Number(result.prediction.tBreachH.toFixed(3)), method: result.prediction.method, confidence: result.prediction.confidence }
          : null,
      });
    },
    onTick: async ({ simNowMs, events }) => {
      for (const e of events) rec.write("event", { at: simNowMs, ...e });
    },
  });

  world.loadScenario(scenario);
  world.clock.play(0);

  // Drive the clock directly: one step per simulated 10 minutes.
  const stepMs = 10 * 60 * 1000;
  const steps = Math.ceil((SIM_MINUTES * 60 * 1000) / stepMs);
  process.stdout.write(`recording ${SIM_MINUTES} simulated minutes `);
  for (let i = 1; i <= steps; i++) {
    world.clock.seek(nowMs + i * stepMs);
    await world.step(Date.now());
    if (i % 3 === 0) process.stdout.write(".");
  }
  process.stdout.write("\n");

  const manifest = await rec.close({
    scenario: scenario.id,
    seed: SEED,
    simulatedMinutes: SIM_MINUTES,
    startMs: nowMs,
    recordedWith: "npm run record",
  });

  console.log(`\n✅ ${manifest.lines} entries -> recordings/${manifest.file}`);
  console.log(`   sha256 ${manifest.sha256.slice(0, 16)}…`);
  console.log(`   Regenerate with: SEED=${SEED} npm run record`);
  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error("✖ record failed:", e.message);
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(1);
});
