"use strict";
/**
 * Integration test for the cold-chain pipeline: a real Mongo (in-memory), real
 * models, real engines. Proves the chain sanity -> bands -> severity -> clock
 * -> prediction works end to end, not just that the pure functions do.
 */
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");

const Shipment = require("../models/Shipment");
const RuleProfile = require("../models/RuleProfile");
const Excursion = require("../models/Excursion");
const Alert = require("../models/Alert");
const coldChain = require("./coldChain");
const profileFile = require("../data/rule-profiles.json");

const H = 3.6e6;
const MIN = 60000;
const T0 = 1_700_000_000_000;

let mongod;
let profile;

before(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.connection.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Shipment.deleteMany({}), RuleProfile.deleteMany({}),
    Excursion.deleteMany({}), Alert.deleteMany({}),
  ]);
  coldChain.resetWindows();

  profile = await RuleProfile.create(
    profileFile.profiles.find((p) => p.profileKey === "mrna_comirnaty_thawed")
  );

  await Shipment.create({
    shipmentId: "VX-TEST",
    cargoType: "Vaccine",
    origin: "Pune",
    destination: "Nairobi",
    status: "In Transit",
    tempProfileId: profile._id,
    eta: new Date(T0 + 48 * H),
    needByAt: new Date(T0 + 96 * H),
    declaredValueUsd: 1_000_000,
    doses: 200_000,
    carrier: "MAEU",
    setpointC: 5,
  });
});

/** Feed a series of readings spaced `gapMin` apart. */
async function feed(temps, { gapMin = 10, startMs = T0, unitMode = "running", ambientC = 30 } = {}) {
  const results = [];
  for (let i = 0; i < temps.length; i++) {
    results.push(await coldChain.processReading({
      shipmentId: "VX-TEST",
      temperatureCelsius: temps[i],
      recordedAt: startMs + i * gapMin * MIN,
      ambientC,
      unitMode,
      powerSource: unitMode === "fault" ? "none" : "unit_running",
      batteryPct: 80,
      doorOpen: false,
    }));
  }
  return results;
}

describe("coldChain pipeline", () => {
  it("in-range readings open no excursion", async () => {
    await feed([4.1, 4.3, 4.0, 4.2, 4.4]);
    assert.strictEqual(await Excursion.countDocuments({}), 0);
  });

  it("a sustained rise above 8 C opens an excursion graded by the rules", async () => {
    const out = await feed([4.0, 5.2, 6.4, 7.6, 8.7, 9.3, 10.1]);
    const exc = await Excursion.findOne({ shipmentId: "VX-TEST", status: "Open" }).lean();
    assert.ok(exc, "expected an open excursion");
    assert.ok(["Warning", "Minor", "Major", "Critical"].includes(exc.severity));
    assert.ok(exc.peakTempC >= 10);
    assert.ok(out.some((r) => r.events.includes("excursion_opened")));
  });

  it("the excursion records which profile version judged it", async () => {
    await feed([4.0, 9.0, 9.4]);
    const exc = await Excursion.findOne({ status: "Open" }).lean();
    assert.strictEqual(exc.ruleProfileRef.profileKey, "mrna_comirnaty_thawed");
    assert.strictEqual(exc.ruleProfileRef.version, 1);
  });

  it("it names a disposition and who must sign it", async () => {
    await feed([4.0, 9.0, 9.5, 10.0]);
    const exc = await Excursion.findOne({ status: "Open" }).lean();
    assert.ok(["release", "release_with_note", "quarantine_qa", "reject"].includes(exc.recommendedDisposition));
    assert.ok(["controller", "qa_rp"].includes(exc.requiredRole));
  });

  it("a single spike between two normal readings is not an excursion", async () => {
    await feed([4.2, 4.3, 12.0, 4.25, 4.3]);
    const count = await Excursion.countDocuments({});
    assert.strictEqual(count, 0, "a lone spike should be filtered, not alarmed on");
  });

  it("two in-range readings close an open excursion", async () => {
    await feed([4.0, 9.2, 9.6]);
    assert.ok(await Excursion.findOne({ status: "Open" }), "excursion should be open");
    await feed([4.5, 4.4], { startMs: T0 + 10 * 60 * MIN });
    const open = await Excursion.findOne({ status: "Open" });
    assert.strictEqual(open, null, "two in-range readings should close it");
    const closed = await Excursion.findOne({ status: "Closed" });
    assert.ok(closed && closed.endedAt, "closed excursion should have an end time");
  });

  it("the life clock reports two clocks and which one binds", async () => {
    await feed([4.1, 4.2]);
    const lc = await coldChain.lifeClockFor("VX-TEST", T0);
    assert.ok(lc.scheduleMarginH > 0);
    assert.ok(lc.stabilityMarginH > 0);
    assert.strictEqual(lc.lifeClockH, Math.min(lc.scheduleMarginH, lc.stabilityMarginH));
    assert.ok(["schedule", "stability"].includes(lc.bindingConstraint));
  });

  it("time out of range drains the stability clock", async () => {
    const before = await coldChain.lifeClockFor("VX-TEST", T0);
    await feed([4.0, 9.5, 9.8, 10.2, 10.5, 10.9], { gapMin: 60 });
    const after = await coldChain.lifeClockFor("VX-TEST", T0 + 5 * H);
    assert.ok(
      after.stabilityMarginH < before.stabilityMarginH,
      `stability should fall: ${before.stabilityMarginH} -> ${after.stabilityMarginH}`
    );
  });

  it("money at risk rises as the clock falls", async () => {
    const before = await coldChain.lifeClockFor("VX-TEST", T0);
    await feed([4.0, 11, 12, 13, 14, 15, 16, 17], { gapMin: 90 });
    const after = await coldChain.lifeClockFor("VX-TEST", T0 + 12 * H);
    assert.ok(after.usdAtRisk >= before.usdAtRisk);
    assert.ok(after.dosesAtRisk >= before.dosesAtRisk);
  });

  it("a warming trend predicts a breach before it happens", async () => {
    // Still below the 8 C limit at every sample.
    const out = await feed([4.0, 4.6, 5.2, 5.8, 6.3, 6.8, 7.2], { gapMin: 20, unitMode: "fault", ambientC: 32 });
    const predicted = out.filter((r) => r.prediction);
    assert.ok(predicted.length > 0, "expected a breach prediction while still in range");
    const p = predicted[predicted.length - 1].prediction;
    assert.ok(p.tBreachH > 0, "time to breach should be positive");
    assert.ok(["newton", "slope"].includes(p.method));
  });

  it("an excursion is attributed to the carrier holding the cargo", async () => {
    await feed([4.0, 9.2, 9.7]);
    const exc = await Excursion.findOne({ status: "Open" }).lean();
    assert.strictEqual(exc.custodyCarrier, "MAEU");
  });

  it("a root cause is diagnosed, not guessed", async () => {
    await feed([4.0, 9.2, 10.4, 11.5], { unitMode: "fault", ambientC: 33 });
    const exc = await Excursion.findOne({ status: "Open" }).lean();
    assert.ok(exc.rootCause && exc.rootCause.code, "expected a root cause code");
    assert.ok(typeof exc.rootCause.confidence === "string");
  });

  it("one problem raises one alert, not a pile", async () => {
    await feed([4.0, 9.2, 9.8, 10.3, 10.9, 11.4], { gapMin: 10 });
    const alerts = await Alert.find({ coalesceKey: /excursion/ }).lean();
    assert.ok(alerts.length <= 1, `expected coalescing, got ${alerts.length} alerts`);
  });

  it("the alert carries the profile citation and the cause", async () => {
    await feed([4.0, 9.4, 10.2], { unitMode: "fault" });
    const alert = await Alert.findOne({ coalesceKey: /excursion/ }).lean();
    assert.ok(alert, "expected an alert");
    assert.match(alert.message, /2–8°C|2-8°C/, "should cite the profile range");
    assert.match(alert.message, /Cause:/, "should name a cause");
    assert.match(alert.message, /signed by/, "should say who signs it");
  });

  it("an unknown shipment is skipped, not crashed on", async () => {
    const r = await coldChain.processReading({
      shipmentId: "NOPE", temperatureCelsius: 30, recordedAt: T0,
    });
    assert.strictEqual(r.skipped, "unknown shipment");
  });
});
