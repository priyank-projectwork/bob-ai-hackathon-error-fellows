'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classify, severityMax, requiredRoleFor, meanKineticTemp } = require('./regulatoryEngine.js');

// Shared vaccine profile (2–8 °C, 12 h warm budget, freeze sensitive)
const VACCINE = {
  bands: { warm: { budgetH: 12 }, cold: { budgetH: 48 } },
  freeze: { sensitive: true, sustainedMin: 30 },
};

const EMPTY_THERMAL = { consumedH: {} };

describe('regulatoryEngine', () => {
  // ─── Test 1: 22 min at 8.6 °C (warm row, <1h) → Warning (NOT Minor) ────────
  it('22 min at 8.6 °C warm row <1h → Warning', () => {
    const result = classify({
      bandKey: 'warm',
      durationMin: 22,
      peakC: 8.6,
      minC: 8.0,
      samples: [{ tempC: 8.6, durationMin: 22 }],
      profile: VACCINE,
      thermal: EMPTY_THERMAL,
    });
    assert.strictEqual(result.severity, 'Warning');
  });

  // ─── Test 2: 3 h at 12 °C → Minor; 11 h at 12 °C → Major ────────────────
  it('3 h at 12 °C warm row 1-10h → Minor', () => {
    const result = classify({
      bandKey: 'warm',
      durationMin: 180,
      peakC: 12,
      minC: 9,
      samples: [{ tempC: 12, durationMin: 180 }],
      profile: VACCINE,
      thermal: EMPTY_THERMAL,
    });
    assert.strictEqual(result.severity, 'Minor');
  });

  it('11 h at 12 °C warm row >=10h → Major', () => {
    const result = classify({
      bandKey: 'warm',
      durationMin: 660,
      peakC: 12,
      minC: 9,
      samples: [{ tempC: 12, durationMin: 660 }],
      profile: VACCINE,
      thermal: EMPTY_THERMAL,
    });
    assert.strictEqual(result.severity, 'Major');
  });

  // ─── Test 3: 30 min at 18 °C (hot row, <1h) → Minor ─────────────────────
  it('30 min at 18 °C hot row <1h → Minor', () => {
    const result = classify({
      bandKey: 'hot',
      durationMin: 30,
      peakC: 18,
      minC: 15,
      samples: [{ tempC: 18, durationMin: 30 }],
      profile: VACCINE,
      thermal: EMPTY_THERMAL,
    });
    assert.strictEqual(result.severity, 'Minor');
  });

  // ─── Test 4: Freeze at -2 °C sustained 60 min → Critical, no MKT ─────────
  it('freeze at -2 °C sustained 60 min → Critical, mktApplies false, mkt null', () => {
    const result = classify({
      bandKey: 'freeze',
      durationMin: 60,
      peakC: 2,
      minC: -2,
      samples: [{ tempC: -2, durationMin: 60 }],
      profile: VACCINE,
      thermal: EMPTY_THERMAL,
    });
    assert.strictEqual(result.severity, 'Critical');
    assert.strictEqual(result.mktApplies, false);
    assert.strictEqual(result.mkt, null);
  });

  // ─── Test 5: 6 h consumed of a 12 h budget → cumulative forces >= Major ───
  it('6 h consumed of 12 h budget → cumulative forces at least Major', () => {
    const result = classify({
      bandKey: 'warm',
      durationMin: 22, // matrix would say Warning
      peakC: 9,
      minC: 8,
      samples: [{ tempC: 9, durationMin: 22 }],
      profile: VACCINE,
      thermal: { consumedH: { warm: 6 } }, // 50% of 12 h budget
    });
    const rank = { None: 0, Warning: 1, Minor: 2, Major: 3, Critical: 4 };
    assert.ok(rank[result.severity] >= rank['Major'], `expected >= Major, got ${result.severity}`);
  });

  // ─── Test 6: meanKineticTemp of constant 8 °C → 8 °C ± 0.1 ──────────────
  it('meanKineticTemp of constant 8 °C → 8 °C within 0.1', () => {
    const samples = [
      { tempC: 8, durationMin: 10 },
      { tempC: 8, durationMin: 10 },
      { tempC: 8, durationMin: 10 },
    ];
    const mkt = meanKineticTemp(samples);
    assert.ok(Math.abs(mkt - 8) < 0.1, `MKT was ${mkt}, expected ~8`);
  });

  // ─── Test 7: MKT biased toward hot samples ────────────────────────────────
  it('meanKineticTemp biased toward hot samples vs plain mean', () => {
    // 4 °C for 10 h, 20 °C for 2 h → plain mean = (4*10 + 20*2) / 12 = 6.67
    const samples = [
      { tempC: 4,  durationMin: 600 },
      { tempC: 20, durationMin: 120 },
    ];
    const mkt = meanKineticTemp(samples);
    const plainMean = (4 * 10 + 20 * 2) / 12;
    assert.ok(mkt > plainMean, `MKT ${mkt} should be > plain mean ${plainMean}`);
  });

  // ─── Test 8: requiredRoleFor ──────────────────────────────────────────────
  it('requiredRoleFor Major → qa_rp', () => {
    assert.strictEqual(requiredRoleFor('Major'), 'qa_rp');
  });

  it('requiredRoleFor Minor → controller', () => {
    assert.strictEqual(requiredRoleFor('Minor'), 'controller');
  });
});
