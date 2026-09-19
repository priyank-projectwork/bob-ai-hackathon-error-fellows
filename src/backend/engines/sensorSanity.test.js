'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { accept, silenceCheck, stuckCheck } = require('./sensorSanity.js');

const PROFILE = {}; // defaults apply
const NOW_MS = 1_700_000_000_000; // fixed, never Date.now()

describe('sensorSanity', () => {
  // ─── Test 1: spike detection ─────────────────────────────────────────────
  it('12 °C between two 4.5 °C → SPIKE, not accepted', () => {
    const prev   = { tempC: 4.5, timestampMs: NOW_MS - 10 * 60000 };
    const sample = { tempC: 12,  timestampMs: NOW_MS };
    const next   = { tempC: 4.5, timestampMs: NOW_MS + 10 * 60000 };
    const result = accept({ sample, prev, next, profile: PROFILE });
    assert.strictEqual(result.accepted, false);
    assert.ok(result.flags.includes('SPIKE'));
  });

  // ─── Test 2: two consecutive 9 °C not a spike ────────────────────────────
  it('two consecutive 9 °C readings → both accepted (real excursion)', () => {
    const s1 = { tempC: 9, timestampMs: NOW_MS - 10 * 60000 };
    const s2 = { tempC: 9, timestampMs: NOW_MS };
    const s3 = { tempC: 9, timestampMs: NOW_MS + 10 * 60000 };

    // First 9 °C: prev is some in-range sample, next is also 9 °C
    const r1 = accept({ sample: s2, prev: s1, next: s3, profile: PROFILE });
    assert.strictEqual(r1.accepted, true);
    // Second 9 °C
    const r2 = accept({ sample: s3, prev: s2, next: null, profile: PROFILE });
    assert.strictEqual(r2.accepted, true);
  });

  // ─── Test 3: 45 min silence at 10 min interval → SENSOR_SILENT, no escalate
  it('45 min silence → SENSOR_SILENT, escalate false', () => {
    const result = silenceCheck({
      lastAcceptedAtMs: NOW_MS - 45 * 60000,
      nowMs: NOW_MS,
      profile: PROFILE,
      legMode: 'Road',
      expectBlackout: false,
    });
    assert.ok(result !== null);
    assert.strictEqual(result.kind, 'SENSOR_SILENT');
    assert.strictEqual(result.escalate, false);
  });

  // ─── Test 4: 70 min silence → escalate true ──────────────────────────────
  it('70 min silence → escalate true', () => {
    const result = silenceCheck({
      lastAcceptedAtMs: NOW_MS - 70 * 60000,
      nowMs: NOW_MS,
      profile: PROFILE,
      legMode: 'Road',
      expectBlackout: false,
    });
    assert.ok(result !== null);
    assert.strictEqual(result.escalate, true);
  });

  // ─── Test 5: Sea leg + expectBlackout + 5 h → null (no alarm) ────────────
  it('Sea leg with expectBlackout and 5 h silence → null', () => {
    const result = silenceCheck({
      lastAcceptedAtMs: NOW_MS - 5 * 60 * 60000,
      nowMs: NOW_MS,
      profile: PROFILE,
      legMode: 'Sea',
      expectBlackout: true,
    });
    assert.strictEqual(result, null);
  });

  // ─── Test 6: six identical readings → STUCK ──────────────────────────────
  it('six identical readings → stuckCheck returns true', () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({
      tempC: 5.0,
      timestampMs: NOW_MS + i * 10 * 60000,
    }));
    assert.strictEqual(stuckCheck({ samples, profile: PROFILE }), true);
  });

  // ─── Test 7: out-of-order sample → OUT_OF_ORDER, not accepted ────────────
  it('sample timestamped before previous → OUT_OF_ORDER, not accepted', () => {
    const prev   = { tempC: 5, timestampMs: NOW_MS };
    const sample = { tempC: 5, timestampMs: NOW_MS - 60000 }; // older
    const result = accept({ sample, prev, next: null, profile: PROFILE });
    assert.strictEqual(result.accepted, false);
    assert.ok(result.flags.includes('OUT_OF_ORDER'));
  });
});
