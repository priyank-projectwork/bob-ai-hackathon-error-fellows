/**
 * viabilityClock.js
 * Core life-clock engine: pure functions, no I/O, no Date.now().
 * Every function that needs "now" takes nowMs as an explicit parameter.
 */

// ─── Arrhenius-weighted display ─────────────────────────────────────────────
// Arrhenius-weighted display (model, illustrative); budget accounting is plain time-out-of-range.
// kineticWeight is for UI animation ONLY — it must NOT appear in consumedH,
// stabilityMarginH, or feasibility calculations.
const ARRHENIUS_DH_OVER_R = 10000; // K [illustrative]
const T_REF_K = 273.15 + 5;        // 5 °C reference [illustrative]

/**
 * Arrhenius kinetic weight — display only, never a decision input.
 * @param {number} tempC
 * @returns {number}
 */
function kineticWeight(tempC) {
  const T_K = 273.15 + tempC;
  return Math.exp(ARRHENIUS_DH_OVER_R * (1 / T_REF_K - 1 / T_K));
}

// ─── computeClock ────────────────────────────────────────────────────────────

// Power sources that mean the unit is actively maintained — no budget drains.
const ACTIVE_POWER_SOURCES = new Set([
  'vessel_plug',
  'terminal_plug',
  'unit_running',
  'cold_depot',
  'bonded_cold_store',
]);

/**
 * Compute the viability clock for a shipment snapshot.
 *
 * @param {object} p
 * @param {number}  p.nowMs              - wall-clock epoch ms (explicit, never Date.now())
 * @param {number}  p.needByAtMs         - delivery deadline epoch ms
 * @param {number}  p.predictedEtaAtMs   - predicted arrival epoch ms
 * @param {object}  p.profile            - cargo profile
 * @param {object}  p.thermal            - thermal snapshot {consumedH, freezeSustainedMin, packagingHoldRemainingH}
 * @param {string}  p.powerSource        - current power source string
 * @returns {object}
 */
function computeClock({ nowMs, needByAtMs, predictedEtaAtMs, profile, thermal, powerSource }) {
  // scheduleMarginH: plain calendar arithmetic, hours until deadline vs ETA
  const scheduleMarginH = (needByAtMs - predictedEtaAtMs) / 3.6e6;

  // ── Stability margin ──────────────────────────────────────────────────────
  // Budget accounting: PLAIN time-out-of-range, no multiplier anywhere.
  const bands = profile.bands || {};
  const consumedH = thermal.consumedH || {};

  // Bands that share a budget are counted once.
  const countedPools = new Set();
  let stabilityBandH = 0;

  for (const [bandKey, band] of Object.entries(bands)) {
    const pool = band.sharesBudgetWith || bandKey;
    if (countedPools.has(pool)) continue;
    countedPools.add(pool);

    // Gather all bands in this pool
    let poolConsumedH = 0;
    let poolBudgetH = band.budgetH;

    for (const [bk, b] of Object.entries(bands)) {
      if ((b.sharesBudgetWith || bk) === pool) {
        poolConsumedH += (consumedH[bk] || 0);
        // budget is the same for all members of the pool (shared)
      }
    }

    const remaining = Math.max(0, poolBudgetH - poolConsumedH);
    stabilityBandH += remaining;
  }

  const packagingHoldRemainingH = thermal.packagingHoldRemainingH || 0;
  let stabilityMarginH = stabilityBandH + packagingHoldRemainingH;

  // ── Freeze irreversibility ────────────────────────────────────────────────
  const freezeCfg = profile.freeze || {};
  const irreversible =
    !!freezeCfg.sensitive &&
    (thermal.freezeSustainedMin || 0) >= (freezeCfg.sustainedMin || Infinity);

  if (irreversible) {
    stabilityMarginH = 0;
  }

  // ── Life-clock ────────────────────────────────────────────────────────────
  let lifeClockH = Math.min(scheduleMarginH, stabilityMarginH);
  if (irreversible) lifeClockH = 0;

  const bindingConstraint = scheduleMarginH <= stabilityMarginH ? 'schedule' : 'stability';

  // drainNow: 0 when in range AND on active power; 1 otherwise.
  // "in range" means powerSource is in the active set.
  const drainNow = ACTIVE_POWER_SOURCES.has(powerSource) ? 0 : 1; // [illustrative]

  // ── State ─────────────────────────────────────────────────────────────────
  let state;
  if (irreversible || lifeClockH <= 0) {
    state = 'black';
  } else if (lifeClockH < 6) {
    state = 'red';
  } else if (lifeClockH < 24) {
    state = 'amber';
  } else {
    state = 'green';
  }

  return {
    scheduleMarginH,
    stabilityMarginH,
    lifeClockH,
    bindingConstraint,
    drainNow,
    irreversible,
    state,
  };
}

// ─── feasibility ─────────────────────────────────────────────────────────────

const QA_MARGIN_H = 24; // [illustrative]

/**
 * Assess whether a routing option is feasible given the current clock state.
 *
 * @param {object} p
 * @param {number}  p.needByAtMs
 * @param {object}  p.option    - {etaAtMs, expectedOutOfRangeH: {[band]: hours}}
 * @param {object}  p.clock     - result of computeClock()
 * @param {object}  p.profile   - cargo profile (for qaMarginH)
 * @returns {object}
 */
function feasibility({ needByAtMs, option, clock, profile }) {
  const scheduleAtDeliveryH = (needByAtMs - option.etaAtMs) / 3.6e6;

  // stability at delivery: current margin minus additional out-of-range time on this option.
  // Plain time-out-of-range — no multipliers (display kineticWeight must NOT appear here).
  const outOfRangeH = option.expectedOutOfRangeH || {};
  const totalOutH = Object.values(outOfRangeH).reduce((s, v) => s + v, 0);
  const stabilityAtDeliveryH = clock.stabilityMarginH - totalOutH;

  const lifeClockAtDeliveryH = Math.min(scheduleAtDeliveryH, stabilityAtDeliveryH);

  const feasible = lifeClockAtDeliveryH > 0;
  const reason = scheduleAtDeliveryH <= 0 ? 'schedule' : 'stability';

  const qaMarginH = (profile && profile.qaMarginH != null) ? profile.qaMarginH : QA_MARGIN_H;
  const needsReason = feasible && lifeClockAtDeliveryH < qaMarginH;

  return {
    scheduleAtDeliveryH,
    stabilityAtDeliveryH,
    lifeClockAtDeliveryH,
    feasible,
    reason,
    needsReason,
  };
}

// ─── financials ──────────────────────────────────────────────────────────────

const P_LOSS_SCALE_H = 6; // [illustrative]

/**
 * Financial exposure from clock proximity to zero.
 *
 * @param {object} p
 * @param {number}  p.lifeClockAtDeliveryH
 * @param {number}  p.declaredValueUsd
 * @param {number}  p.doses
 * @returns {object}
 */
function financials({ lifeClockAtDeliveryH, declaredValueUsd, doses }) {
  const pLoss =
    lifeClockAtDeliveryH <= 0
      ? 1
      : Math.exp(-lifeClockAtDeliveryH / P_LOSS_SCALE_H);

  const usdAtRisk = pLoss * declaredValueUsd;
  const dosesAtRisk = Math.round(pLoss * doses);

  return { pLoss, usdAtRisk, dosesAtRisk };
}

module.exports = {
  computeClock,
  feasibility,
  financials,
  kineticWeight,
};
