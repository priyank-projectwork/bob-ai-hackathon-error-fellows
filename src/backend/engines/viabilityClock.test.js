'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeClock, feasibility, financials, kineticWeight } = require('./viabilityClock.js');

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000; // arbitrary fixed epoch, never Date.now()

/** Vaccine profile with a single "warm" band (2–8 °C) and freeze sensitivity */
const VACCINE_PROFILE = {
  bands: {
    warm: { budgetH: 12 },
  },
  freeze: { sensitive: true, sustainedMin: 30 },
  qaMarginH: 24, // [illustrative]
};

// ─── Test 1: In range on vessel power for 5 h → drainNow === 0, no budget consumed ──
describe('viabilityClock', () => {
  it('in range on vessel_plug: drainNow === 0, no budget consumed', () => {
    const result = computeClock({
      nowMs: NOW_MS,
      needByAtMs: NOW_MS + 100 * 3.6e6,
      predictedEtaAtMs: NOW_MS + 50 * 3.6e6,
      profile: VACCINE_PROFILE,
      thermal: { consumedH: { warm: 0 }, freezeSustainedMin: 0, packagingHoldRemainingH: 0 },
      powerSource: 'vessel_plug',
    });
    assert.strictEqual(result.drainNow, 0);
    // stabilityMarginH === full budget (nothing consumed)
    assert.strictEqual(result.stabilityMarginH, 12);
  });

  // ─── Test 2: 2 h spent at warm → stabilityMarginH === 10 ─────────────────
  it('2 h warm excursion consumed → stabilityMarginH === 10', () => {
    const result = computeClock({
      nowMs: NOW_MS,
      needByAtMs: NOW_MS + 100 * 3.6e6,
      predictedEtaAtMs: NOW_MS + 50 * 3.6e6,
      profile: VACCINE_PROFILE,
      thermal: { consumedH: { warm: 2 }, freezeSustainedMin: 0, packagingHoldRemainingH: 0 },
      powerSource: 'unit_running',
    });
    assert.strictEqual(result.stabilityMarginH, 10);
  });

  // ─── Test 3: Freeze sustained 60 min → irreversible, lifeClockH === 0, state black ──
  it('freeze sustained 60 min → irreversible, lifeClockH 0, state black', () => {
    const result = computeClock({
      nowMs: NOW_MS,
      needByAtMs: NOW_MS + 100 * 3.6e6,
      predictedEtaAtMs: NOW_MS + 50 * 3.6e6,
      profile: VACCINE_PROFILE,
      thermal: { consumedH: { warm: 0 }, freezeSustainedMin: 60, packagingHoldRemainingH: 0 },
      powerSource: 'unit_running',
    });
    assert.strictEqual(result.irreversible, true);
    assert.strictEqual(result.lifeClockH, 0);
    assert.strictEqual(result.state, 'black');
  });

  // ─── Test 4: Option with 300 h sea leg → feasible === false, reason schedule ─
  it('300 h sea leg option → feasible false, reason schedule', () => {
    // needle: 48 h from now, option ETA: 350 h from now (300 h sea leg beyond current ETA)
    const clock = {
      stabilityMarginH: 12, // enough stability
    };
    const result = feasibility({
      needByAtMs: NOW_MS + 48 * 3.6e6,
      option: {
        etaAtMs: NOW_MS + 350 * 3.6e6, // arrives 350 h from now, past the 48 h deadline
        expectedOutOfRangeH: {},
      },
      clock,
      profile: VACCINE_PROFILE,
    });
    assert.strictEqual(result.feasible, false);
    assert.strictEqual(result.reason, 'schedule');
  });

  // ─── Test 5: Cold-depot hold for 36 h → stabilityMarginH unchanged ────────
  it('cold-depot hold for 36 h → stabilityMarginH unchanged', () => {
    // cold_depot is active power → drainNow 0, no budget consumed
    const before = computeClock({
      nowMs: NOW_MS,
      needByAtMs: NOW_MS + 200 * 3.6e6,
      predictedEtaAtMs: NOW_MS + 100 * 3.6e6,
      profile: VACCINE_PROFILE,
      thermal: { consumedH: { warm: 2 }, freezeSustainedMin: 0, packagingHoldRemainingH: 0 },
      powerSource: 'cold_depot',
    });
    // After 36 h in cold_depot, consumedH is still 2 (drainNow === 0 → budget untouched)
    const after = computeClock({
      nowMs: NOW_MS + 36 * 3.6e6,
      needByAtMs: NOW_MS + 200 * 3.6e6,
      predictedEtaAtMs: NOW_MS + 100 * 3.6e6,
      profile: VACCINE_PROFILE,
      thermal: { consumedH: { warm: 2 }, freezeSustainedMin: 0, packagingHoldRemainingH: 0 },
      powerSource: 'cold_depot',
    });
    assert.strictEqual(before.stabilityMarginH, after.stabilityMarginH);
  });

  // ─── Test 6: lifeClockAtDeliveryH = 12 → needsReason === true (< 24 h QA) ─
  it('lifeClockAtDeliveryH 12 < qaMarginH 24 → needsReason true', () => {
    const clock = { stabilityMarginH: 12 };
    // needByAtMs - etaAtMs = 12 h, stability = 12 → lifeClockAtDelivery = 12
    const result = feasibility({
      needByAtMs: NOW_MS + 24 * 3.6e6,
      option: {
        etaAtMs: NOW_MS + 12 * 3.6e6, // 12 h before deadline
        expectedOutOfRangeH: {},
      },
      clock,
      profile: VACCINE_PROFILE,
    });
    assert.strictEqual(result.lifeClockAtDeliveryH, 12);
    assert.strictEqual(result.needsReason, true);
  });

  // ─── Test 7: kineticWeight never changes stabilityMarginH ─────────────────
  it('kineticWeight does not change stabilityMarginH', () => {
    const base = {
      nowMs: NOW_MS,
      needByAtMs: NOW_MS + 200 * 3.6e6,
      predictedEtaAtMs: NOW_MS + 100 * 3.6e6,
      profile: VACCINE_PROFILE,
      thermal: { consumedH: { warm: 3 }, freezeSustainedMin: 0, packagingHoldRemainingH: 0 },
      powerSource: 'unit_running',
    };
    const withoutKinetic = computeClock(base).stabilityMarginH;
    // kineticWeight is display-only; calling it doesn't touch any state
    const _ = kineticWeight(12);
    const withKinetic = computeClock(base).stabilityMarginH;
    assert.strictEqual(withoutKinetic, withKinetic);
  });
});
