'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { predict, timeToBreachNewton, fitNewtonK } = require('./breachPredictor.js');

const NOW_MS = 1_700_000_000_000; // fixed epoch, never Date.now()

// Generate Newton-cooling samples from exact parameters
function newtonSamples(k, T0, Tamb, count, intervalH) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const tH = i * intervalH;
    const tempC = Tamb - (Tamb - T0) * Math.exp(-k * tH);
    samples.push({ tempC, timestampMs: NOW_MS + tH * 3.6e6, tH });
  }
  return samples;
}

describe('breachPredictor', () => {
  // ─── Test 1: anchor — timeToBreachNewton ─────────────────────────────────
  it('timeToBreachNewton anchor: k=0.03, T0=4, Tlim=8, Tamb=30 → ~5.568h', () => {
    const t = timeToBreachNewton({ k: 0.03, T0: 4, TlimC: 8, TambC: 30 });
    assert.ok(Math.abs(t - 5.568) < 0.1, `Expected ~5.568, got ${t}`);
  });

  // ─── Test 2: fitNewtonK recovers k from generated curve ──────────────────
  it('fitNewtonK on Newton-generated samples recovers k=0.0300 ±0.001, r²>=0.99', () => {
    // Generate 20 samples at 0.3 h intervals
    const rawSamples = newtonSamples(0.03, 4, 30, 20, 0.3);
    const { k, r2 } = fitNewtonK({ samples: rawSamples, ambientC: 30 });
    assert.ok(Math.abs(k - 0.03) < 0.001, `k was ${k}, expected 0.030`);
    assert.ok(r2 >= 0.99, `r² was ${r2}, expected >= 0.99`);
  });

  // ─── Test 3: TlimC >= TambC → Infinity ───────────────────────────────────
  it('TlimC >= TambC → Infinity', () => {
    const t = timeToBreachNewton({ k: 0.03, T0: 4, TlimC: 35, TambC: 30 });
    assert.strictEqual(t, Infinity);
  });

  // ─── Test 4: fewer than 3 samples → null ─────────────────────────────────
  it('only two samples → predict returns null', () => {
    const samples = [
      { tempC: 4, timestampMs: NOW_MS },
      { tempC: 5, timestampMs: NOW_MS + 10 * 60000 },
    ];
    const result = predict({ samples, ambientC: 30, profile: { maxTempC: 8 }, nowMs: NOW_MS });
    assert.strictEqual(result, null);
  });

  // ─── Test 5: flat samples, no ambient → null (slope not positive) ─────────
  it('flat samples, no ambient → null', () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({
      tempC: 5,
      timestampMs: NOW_MS + i * 10 * 60000,
    }));
    const result = predict({ samples, ambientC: null, profile: { maxTempC: 8 }, nowMs: NOW_MS });
    assert.strictEqual(result, null);
  });

  // ─── Test 6: rising samples, no ambient → method "slope", positive tBreachH
  it('rising samples, no ambient → method slope, positive tBreachH', () => {
    // Rising at 1 °C / 10 min = 6 °C/h, starting at 5 °C, limit 8 °C → breach in 0.5 h
    const samples = Array.from({ length: 4 }, (_, i) => ({
      tempC: 5 + i * 1,           // 5, 6, 7, 8
      timestampMs: NOW_MS + i * 10 * 60000,
    }));
    // T_now = 8, which is AT the limit — use a slightly lower last sample
    const s2 = Array.from({ length: 4 }, (_, i) => ({
      tempC: 5 + i * 0.5,         // 5, 5.5, 6, 6.5 → rising toward 8 °C
      timestampMs: NOW_MS + i * 10 * 60000,
    }));
    const result = predict({ samples: s2, ambientC: null, profile: { maxTempC: 8 }, nowMs: NOW_MS });
    assert.ok(result !== null, 'should predict');
    assert.strictEqual(result.method, 'slope');
    assert.ok(result.tBreachH > 0, `tBreachH ${result.tBreachH} should be positive`);
  });

  // ─── Test 7: demo anchor — T_now=7.4, T_amb=34, k=0.03 → ~0.76h ─────────
  it('demo anchor: T_now=7.4, T_amb=34, k=0.03, Tlim=8 → ~0.76h', () => {
    const t = timeToBreachNewton({ k: 0.03, T0: 7.4, TlimC: 8, TambC: 34 });
    assert.ok(Math.abs(t - 0.76) < 0.05, `Expected ~0.76h, got ${t.toFixed(4)}h`);
  });
});
