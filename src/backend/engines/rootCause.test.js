'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { diagnose } = require('./rootCause.js');

const NOW_MS = 1_700_000_000_000; // fixed, never Date.now()
const PROFILE = { maxTempC: 8 };

// Helper to build a window of N snapshots spaced 5 min apart
function makeWindow(overrides = [], base = {}) {
  return overrides.map((o, i) =>
    Object.assign(
      { timestampMs: NOW_MS + i * 5 * 60000, tempC: 5, unitMode: 'running',
        doorOpen: false, powerSource: 'unit_running', batteryPct: 80,
        sanityFlags: [], plannedStop: false },
      base,
      o
    )
  );
}

describe('rootCause', () => {
  // ─── DOOR_OPEN ────────────────────────────────────────────────────────────
  it('door open during planned stop + rising temp → DOOR_OPEN', () => {
    const win = makeWindow([
      { tempC: 6, doorOpen: true, plannedStop: true, unitMode: 'running' },
      { tempC: 7, doorOpen: true, plannedStop: true, unitMode: 'running' },
      { tempC: 9, doorOpen: true, plannedStop: true, unitMode: 'running' },
    ]);
    const result = diagnose({ window: win, profile: PROFILE });
    assert.strictEqual(result.code, 'DOOR_OPEN');
    assert.ok(result.evidence.length > 0);
  });

  // ─── COMPRESSOR_FAULT ─────────────────────────────────────────────────────
  it('unitMode=fault, door closed, battery ok → COMPRESSOR_FAULT', () => {
    const win = makeWindow([
      { unitMode: 'fault', doorOpen: false, batteryPct: 80 },
      { unitMode: 'fault', doorOpen: false, batteryPct: 79 },
    ]);
    const result = diagnose({ window: win, profile: PROFILE });
    assert.strictEqual(result.code, 'COMPRESSOR_FAULT');
    assert.ok(result.evidence.length > 0);
  });

  // ─── POWER_LOSS ───────────────────────────────────────────────────────────
  it('powerSource changed to none, unit not running → POWER_LOSS', () => {
    const win = makeWindow([
      { powerSource: 'vessel_plug', unitMode: 'running' },
      { powerSource: 'none',        unitMode: 'off' },
      { powerSource: 'none',        unitMode: 'off', tempC: 8 },
    ]);
    const result = diagnose({ window: win, profile: PROFILE });
    assert.strictEqual(result.code, 'POWER_LOSS');
    assert.ok(result.evidence.length > 0);
  });

  // ─── AMBIENT_HEAT ────────────────────────────────────────────────────────
  it('unit running, door closed, ambient 25 °C (>8+10), slow rise → AMBIENT_HEAT', () => {
    // Spread over 2 h for a slow rise
    const win = [
      { timestampMs: NOW_MS,                tempC: 8,  unitMode: 'running', doorOpen: false, ambientC: 25, batteryPct: 80, sanityFlags: [], powerSource: 'unit_running', plannedStop: false },
      { timestampMs: NOW_MS + 60 * 60000,   tempC: 9,  unitMode: 'running', doorOpen: false, ambientC: 26, batteryPct: 80, sanityFlags: [], powerSource: 'unit_running', plannedStop: false },
      { timestampMs: NOW_MS + 120 * 60000,  tempC: 10, unitMode: 'running', doorOpen: false, ambientC: 27, batteryPct: 80, sanityFlags: [], powerSource: 'unit_running', plannedStop: false },
    ];
    const result = diagnose({ window: win, profile: PROFILE });
    assert.strictEqual(result.code, 'AMBIENT_HEAT');
    assert.ok(result.evidence.length > 0);
  });

  // ─── PASSIVE_EXPIRED ─────────────────────────────────────────────────────
  it('passiveExpired flag in window → PASSIVE_EXPIRED', () => {
    const win = makeWindow([
      { passiveExpired: true },
    ]);
    const result = diagnose({ window: win, profile: PROFILE });
    assert.strictEqual(result.code, 'PASSIVE_EXPIRED');
    assert.ok(result.evidence.length > 0);
  });

  // ─── SENSOR_SUSPECT ──────────────────────────────────────────────────────
  it('majority of window entries have sanity flags → SENSOR_SUSPECT', () => {
    const win = makeWindow([
      { sanityFlags: ['SPIKE'] },
      { sanityFlags: ['SPIKE'] },
      { sanityFlags: ['STUCK'] },
      { sanityFlags: [] },
    ]);
    const result = diagnose({ window: win, profile: PROFILE });
    assert.strictEqual(result.code, 'SENSOR_SUSPECT');
    assert.ok(result.evidence.length > 0);
  });

  // ─── UNKNOWN ─────────────────────────────────────────────────────────────
  it('nominal window with nothing wrong → UNKNOWN', () => {
    const win = makeWindow([
      { tempC: 5 },
      { tempC: 5 },
    ]);
    const result = diagnose({ window: win, profile: PROFILE });
    assert.strictEqual(result.code, 'UNKNOWN');
  });
});
