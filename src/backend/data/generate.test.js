"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { buildWorld } = require("./generate.js");
const net = require("./network.js");

const NOW = 1_700_000_000_000;
const H = 3.6e6;

describe("generate", () => {
  it("builds roughly 40 shipments and 41 assets", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    assert.ok(w.shipments.length >= 38 && w.shipments.length <= 48, `got ${w.shipments.length}`);
    assert.ok(w.assets.length >= 40, `got ${w.assets.length}`);
  });

  it("is deterministic for a given seed", () => {
    const a = buildWorld({ nowMs: NOW, seed: 7 });
    const b = buildWorld({ nowMs: NOW, seed: 7 });
    assert.deepStrictEqual(
      a.shipments.map((s) => s.shipmentId + s.departedAtMs),
      b.shipments.map((s) => s.shipmentId + s.departedAtMs)
    );
  });

  it("different seeds build different worlds", () => {
    const a = buildWorld({ nowMs: NOW, seed: 1 });
    const b = buildWorld({ nowMs: NOW, seed: 2 });
    assert.notDeepStrictEqual(
      a.shipments.map((s) => s.departedAtMs),
      b.shipments.map((s) => s.departedAtMs)
    );
  });

  // The bug this module exists to kill: absolute ETAs that rot three hours
  // after seeding, so every alert reads "PAST intervention window".
  it("every time is relative to nowMs", () => {
    const early = buildWorld({ nowMs: NOW, seed: 42 });
    const later = buildWorld({ nowMs: NOW + 1000 * H, seed: 42 });
    for (let i = 0; i < early.shipments.length; i++) {
      const shift = later.shipments[i].departedAtMs - early.shipments[i].departedAtMs;
      assert.ok(Math.abs(shift - 1000 * H) < 1, `shipment ${i} did not shift with nowMs`);
    }
  });

  it("no shipment has already blown its deadline at seed time", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    for (const s of w.shipments) {
      assert.ok(s.needByAtMs > NOW, `${s.shipmentId} is already late before the demo starts`);
    }
  });

  it("every shipment is partway along its route, not parked at the origin", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    for (const s of w.shipments) {
      assert.ok(s.departedAtMs < NOW, `${s.shipmentId} has not departed`);
      assert.ok(s.plannedEtaMs > NOW, `${s.shipmentId} has already arrived`);
    }
  });

  it("route coordinates are valid and long enough to move along", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    for (const s of w.shipments) {
      assert.ok(Array.isArray(s.routeCoords) && s.routeCoords.length >= 2, `${s.shipmentId} has no route`);
      for (const [lng, lat] of s.routeCoords) {
        assert.ok(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90);
      }
    }
  });

  it("the hero shipments are present with their scripted identities", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    const hero = w.shipments.find((s) => s.shipmentId === "VX-2291");
    const freeze = w.shipments.find((s) => s.shipmentId === "VX-2304");
    assert.ok(hero, "VX-2291 missing");
    assert.ok(freeze, "VX-2304 missing");
    assert.strictEqual(hero.doses, 240000);
    assert.strictEqual(hero.priority, "Critical");
    assert.strictEqual(hero.profileKey, "mrna_comirnaty_thawed");
  });

  it("a healthy idle reefer sits in Nairobi for the rescue", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    const rescue = w.assets.find((a) => a.assetId === "REEF-341");
    assert.ok(rescue);
    assert.strictEqual(rescue.status, "Idle");
    assert.strictEqual(rescue.unitHealth, "ok");
    assert.ok(rescue.modes.includes("Road"));
  });

  it("assets carry the constraints the matcher needs", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    for (const a of w.assets) {
      assert.ok(a.capacityWeight > 0);
      assert.ok(Array.isArray(a.modes) && a.modes.length > 0, `${a.assetId} has no modes`);
      assert.ok(typeof a.preCoolHours === "number");
      assert.ok(a.minTempC < a.maxTempC);
    }
  });

  it("the fleet is a mix of statuses, not all idle", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    const statuses = new Set(w.assets.map((a) => a.status));
    assert.ok(statuses.size >= 2, "expected a mix of idle and working assets");
    assert.ok(w.assets.some((a) => a.status === "Idle"));
  });

  it("no truck is expected to sail and no vessel to drive", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    const truck = w.assets.find((a) => a.type === "Reefer Truck");
    assert.deepStrictEqual(truck.modes, ["Road"]);
    const vessel = w.assets.find((a) => a.type === "Vessel");
    assert.ok(vessel.modes.includes("Sea") && !vessel.modes.includes("Road"));
  });

  it("carriers carry the fields the scorecard needs", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    for (const c of w.carriers) {
      assert.ok(c.onTimePct > 0 && c.onTimePct <= 100);
      assert.strictEqual(typeof c.gdpCertified, "boolean");
      assert.ok(c.ratePerKm > 0);
    }
  });

  it("shipments reference lanes that exist", () => {
    const w = buildWorld({ nowMs: NOW, seed: 42 });
    const lanes = new Set(net.listLanes());
    for (const s of w.shipments) assert.ok(lanes.has(s.laneId), `unknown lane ${s.laneId}`);
  });
});
