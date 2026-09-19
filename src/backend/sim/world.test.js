"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { World } = require("./world.js");

const T0 = 1_700_000_000_000;
const LA = [-118.24, 34.05];
const DENVER = [-104.99, 39.74];

function makeShipment(overrides = {}) {
  return {
    shipmentId: "SHIP-1",
    routeCoords: [LA, DENVER],
    departedAtMs: T0,
    speedKmh: 80,
    setpointC: 4,
    ...overrides,
  };
}

function makeWorld(shipments, opts = {}) {
  const readings = [];
  const w = new World({ startMs: T0, speed: 3600, seed: 7, ...opts });
  w.configure({
    loadShipments: async () => shipments,
    onReading: async (r) => readings.push(r),
  });
  w.loadScenario({ events: opts.events ?? [] });
  return { w, readings };
}

describe("world", () => {
  it("does not move while paused", async () => {
    const ships = [makeShipment()];
    const { w } = makeWorld(ships);
    await w.step(1000);
    await w.step(5000);
    assert.strictEqual(ships[0].livePosition, undefined);
  });

  it("moves shipments once playing", async () => {
    const ships = [makeShipment()];
    const { w } = makeWorld(ships);
    w.clock.play(0);
    await w.step(3600 * 1000); // 1 real hour at 3600x = 3600 sim hours
    assert.ok(ships[0].livePosition);
    assert.ok(ships[0].livePosition.progressKm > 0);
  });

  it("generates readings on the expected interval", async () => {
    const ships = [makeShipment()];
    const { w, readings } = makeWorld(ships);
    w.clock.play(0);
    // 3600x: 10 sim minutes is 1/6 of a real second
    await w.step(1000);
    assert.ok(readings.length >= 1, "expected at least one reading");
    assert.strictEqual(readings[0].shipmentId, "SHIP-1");
    assert.ok(typeof readings[0].temperatureCelsius === "number");
    assert.ok(Array.isArray(readings[0].position));
  });

  it("readings carry the shipment's live position", async () => {
    const ships = [makeShipment()];
    const { w, readings } = makeWorld(ships);
    w.clock.play(0);
    await w.step(1000);
    const [lng, lat] = readings[0].position;
    assert.ok(lng >= -180 && lng <= 180);
    assert.ok(lat >= -90 && lat <= 90);
  });

  it("a hold event stops the shipment where it stands", async () => {
    const ships = [makeShipment()];
    const { w } = makeWorld(ships, {
      events: [{ atSimMinute: 0, kind: "hold", shipmentId: "SHIP-1" }],
    });
    w.clock.play(0);
    await w.step(1000);
    const first = ships[0].livePosition.progressKm;
    await w.step(3000);
    assert.strictEqual(ships[0].livePosition.progressKm, first, "held shipment moved");
    assert.strictEqual(ships[0].livePosition.etaMs, null);
  });

  it("a compressor_fault event drives the temperature up", async () => {
    const ships = [makeShipment()];
    const { w, readings } = makeWorld(ships, {
      events: [{ atSimMinute: 0, kind: "compressor_fault", shipmentId: "SHIP-1" }],
    });
    w.clock.play(0);
    for (let i = 1; i <= 12; i++) await w.step(i * 1000);
    assert.ok(readings.length > 1);
    assert.strictEqual(readings[readings.length - 1].unitMode, "fault");
    assert.ok(
      readings[readings.length - 1].temperatureCelsius > readings[0].temperatureCelsius,
      "temperature should climb after a compressor fault"
    );
  });

  it("each scripted event fires exactly once", async () => {
    const ships = [makeShipment()];
    const seen = [];
    const w = new World({ startMs: T0, speed: 3600, seed: 7 });
    w.configure({ loadShipments: async () => ships, onTick: async ({ events }) => seen.push(...events) });
    w.loadScenario({ events: [{ atSimMinute: 0, kind: "door_open", shipmentId: "SHIP-1" }] });
    w.clock.play(0);
    await w.step(1000);
    await w.step(2000);
    await w.step(3000);
    assert.strictEqual(seen.length, 1, `event fired ${seen.length} times`);
  });

  it("the same seed produces the same readings", async () => {
    const runA = makeWorld([makeShipment()]);
    const runB = makeWorld([makeShipment()]);
    runA.w.clock.play(0);
    runB.w.clock.play(0);
    for (let i = 1; i <= 5; i++) {
      await runA.w.step(i * 1000);
      await runB.w.step(i * 1000);
    }
    assert.deepStrictEqual(
      runA.readings.map((r) => r.temperatureCelsius),
      runB.readings.map((r) => r.temperatureCelsius)
    );
  });

  it("status reports the simulated clock", async () => {
    const { w } = makeWorld([makeShipment()]);
    const s = w.status();
    assert.strictEqual(s.running, false);
    assert.strictEqual(s.speed, 3600);
    assert.strictEqual(s.mode, "simulate");
  });
});
