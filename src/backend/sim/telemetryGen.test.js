"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { nextReading, ambientC, stepTemp, seededRng, K } = require("./telemetryGen.js");

const T0 = 1_700_000_000_000;
const SETPOINT = 4;

const RUNNING = { tempC: 4, doorOpen: false, unitMode: "running", powerSource: "unit_running", batteryPct: 100 };
const FAULTED = { tempC: 4, doorOpen: false, unitMode: "fault", powerSource: "none", batteryPct: 80 };

describe("telemetryGen", () => {
  it("ambient is warmer near the equator than near the poles", () => {
    const equator = ambientC({ lat: 0, hourOfDay: 12 });
    const arctic = ambientC({ lat: 70, hourOfDay: 12 });
    assert.ok(equator > arctic, `${equator} should exceed ${arctic}`);
  });

  it("ambient swings over the day", () => {
    const afternoon = ambientC({ lat: 20, hourOfDay: 15 });
    const predawn = ambientC({ lat: 20, hourOfDay: 3 });
    assert.ok(afternoon > predawn);
  });

  it("a running unit holds setpoint even in hot ambient", () => {
    let s = { ...RUNNING, tempC: 6 };
    for (let i = 0; i < 20; i++) {
      const r = nextReading({ state: s, lat: 5, simNowMs: T0 + i * 3.6e6, deltaHours: 1, setpointC: SETPOINT, rand: seededRng(1) });
      s = { ...s, tempC: r.temperatureCelsius };
    }
    assert.ok(Math.abs(s.tempC - SETPOINT) < 1, `drifted to ${s.tempC}`);
  });

  it("a faulted unit warms toward ambient and breaches", () => {
    let s = { ...FAULTED };
    let breachedAtH = null;
    for (let h = 1; h <= 12; h++) {
      const r = nextReading({ state: s, lat: 10, simNowMs: T0 + h * 3.6e6, deltaHours: 1, setpointC: SETPOINT, rand: seededRng(2) });
      s = { ...s, tempC: r.temperatureCelsius };
      if (breachedAtH === null && s.tempC > 8) breachedAtH = h;
    }
    assert.ok(breachedAtH !== null, `never breached, ended at ${s.tempC}`);
    assert.ok(breachedAtH >= 2 && breachedAtH <= 10, `breached at ${breachedAtH}h, expected a gradual rise`);
  });

  it("an open door warms faster than a fault", () => {
    const door = nextReading({ state: { ...RUNNING, doorOpen: true }, lat: 10, simNowMs: T0, deltaHours: 1, setpointC: SETPOINT, rand: seededRng(3) });
    const fault = nextReading({ state: FAULTED, lat: 10, simNowMs: T0, deltaHours: 1, setpointC: SETPOINT, rand: seededRng(3) });
    assert.ok(door.kPerH > fault.kPerH);
    assert.ok(door.temperatureCelsius > fault.temperatureCelsius);
  });

  it("a compressor_fault event flips the unit mode", () => {
    const r = nextReading({ state: RUNNING, lat: 10, simNowMs: T0, deltaHours: 0.5, setpointC: SETPOINT, event: { kind: "compressor_fault" }, rand: seededRng(4) });
    assert.strictEqual(r.unitMode, "fault");
    assert.strictEqual(r.powerSource, "none");
  });

  it("battery drains without external power and recovers with it", () => {
    const off = nextReading({ state: FAULTED, lat: 10, simNowMs: T0, deltaHours: 4, setpointC: SETPOINT, rand: seededRng(5) });
    assert.ok(off.batteryPct < FAULTED.batteryPct);
    const on = nextReading({ state: { ...RUNNING, batteryPct: 50 }, lat: 10, simNowMs: T0, deltaHours: 4, setpointC: SETPOINT, rand: seededRng(5) });
    assert.ok(on.batteryPct > 50);
  });

  it("the same seed replays identically", () => {
    const a = nextReading({ state: RUNNING, lat: 12, simNowMs: T0, deltaHours: 1, setpointC: SETPOINT, rand: seededRng(99) });
    const b = nextReading({ state: RUNNING, lat: 12, simNowMs: T0, deltaHours: 1, setpointC: SETPOINT, rand: seededRng(99) });
    assert.deepStrictEqual(a, b);
  });

  it("stepTemp decays toward ambient at the given k", () => {
    // Newton: T(t) = Tamb + (T0 - Tamb) * exp(-k t)
    const out = stepTemp({ tempC: 4, ambient: 30, kPerH: 0.03, deltaHours: 5.568, setpointC: 4, unitRunning: false });
    assert.ok(Math.abs(out - 8) < 0.1, `expected ~8 C at the anchor point, got ${out}`);
  });

  it("K constants are ordered: running > door > fault > passive", () => {
    assert.ok(K.unit_running > K.door_open);
    assert.ok(K.door_open > K.unit_fault);
    assert.ok(K.unit_fault > K.passive);
  });
});
