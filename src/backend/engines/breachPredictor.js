/**
 * breachPredictor.js
 * Predicts a temperature breach before it happens.
 * Pure functions, no I/O, no Date.now().
 * Every function that needs "now" takes nowMs as an explicit parameter.
 */

// ─── Newton's law of cooling — closed form ────────────────────────────────────

/**
 * Time to breach using Newton's law of cooling.
 *
 *   T(t) = T_amb - (T_amb - T0) * exp(-k*t)
 *   At breach: T_lim = T_amb - (T_amb - T0) * exp(-k * t_breach)
 *   => t_breach = -ln( (T_amb - T_lim) / (T_amb - T0) ) / k
 *
 * @param {object} p
 * @param {number}  p.k       - cooling constant (1/h)
 * @param {number}  p.T0      - initial temperature (°C)
 * @param {number}  p.TlimC   - breach threshold temperature (°C)
 * @param {number}  p.TambC   - ambient temperature (°C)
 * @returns {number}  hours to breach, or Infinity if TlimC >= TambC
 */
function timeToBreachNewton({ k, T0, TlimC, TambC }) {
  if (TlimC >= TambC) return Infinity; // ambient can never drive a breach
  const ratio = (TambC - TlimC) / (TambC - T0);
  if (ratio <= 0) return Infinity; // already at or above breach
  return -Math.log(ratio) / k;
}

// ─── fitNewtonK — least-squares through origin ────────────────────────────────

/**
 * Fit Newton's cooling constant k from a series of temperature samples.
 *
 * Model: y_i = ln( (T_amb - T_i) / (T_amb - T_0) )  vs  x_i = t_i
 * Least-squares through origin: k = -sum(x*y) / sum(x*x)
 *
 * @param {object} p
 * @param {Array}   p.samples   - [{tempC, tH}] where tH is hours since start
 * @param {number}  p.ambientC
 * @returns {{ k: number, r2: number }}
 */
function fitNewtonK({ samples, ambientC }) {
  if (!samples || samples.length < 2) return { k: NaN, r2: 0 };

  const T0 = samples[0].tempC;
  const Tamb = ambientC;

  // x is hours since the first sample. Callers may supply it directly as tH,
  // or as an epoch in timestampMs/at — derive it either way rather than
  // silently producing NaN when the field name does not match.
  const t0ms = samples[0].timestampMs ?? samples[0].at ?? null;
  const hoursAt = (s, i) => {
    if (Number.isFinite(s.tH)) return s.tH;
    const ms = s.timestampMs ?? s.at ?? null;
    if (ms !== null && t0ms !== null) return (ms - t0ms) / 3.6e6;
    return i; // last resort: evenly spaced
  };

  // Build (x, y) pairs; skip any sample where the log argument is non-positive
  const pairs = [];
  samples.forEach((s, i) => {
    const num = Tamb - s.tempC;
    const den = Tamb - T0;
    if (num <= 0 || den <= 0) return;
    const y = Math.log(num / den);
    pairs.push({ x: hoursAt(s, i), y });
  });

  if (pairs.length < 2) return { k: NaN, r2: 0 };

  // Least-squares through origin: slope = sum(x*y)/sum(x^2)
  // Model: y = slope * x  →  slope = -k
  let sumXY = 0;
  let sumXX = 0;
  for (const { x, y } of pairs) {
    sumXY += x * y;
    sumXX += x * x;
  }
  if (sumXX === 0) return { k: NaN, r2: 0 };

  const slope = sumXY / sumXX;  // negative for warming
  const k = -slope;

  // R² = 1 - SS_res / SS_tot
  const yMean = pairs.reduce((s, p) => s + p.y, 0) / pairs.length;
  let ssTot = 0;
  let ssRes = 0;
  for (const { x, y } of pairs) {
    const yHat = slope * x;
    ssRes += (y - yHat) ** 2;
    ssTot += (y - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  return { k, r2 };
}

// ─── EWMA slope ───────────────────────────────────────────────────────────────

function _ewmaSlope(samples) {
  const ALPHA = 0.5; // [illustrative]
  if (samples.length < 2) return null;
  let ewma = null;
  for (let i = 1; i < samples.length; i++) {
    const dtH = (samples[i].timestampMs - samples[i - 1].timestampMs) / 3.6e6;
    if (dtH <= 0) continue;
    const dT = samples[i].tempC - samples[i - 1].tempC;
    const inst = dT / dtH;
    ewma = ewma === null ? inst : ALPHA * inst + (1 - ALPHA) * ewma;
  }
  return ewma;
}

// ─── predict ──────────────────────────────────────────────────────────────────

const BREACH_HORIZON_H = 2; // [illustrative]

/**
 * Predict a breach before it happens.
 *
 * @param {object} p
 * @param {Array}   p.samples    - accepted telemetry [{tempC, timestampMs}]
 * @param {number}  [p.ambientC] - current ambient temperature
 * @param {object}  p.profile    - cargo profile { maxTempC }
 * @param {number}  p.nowMs      - current epoch ms (never Date.now())
 * @returns {null | object}
 */
function predict({ samples, ambientC, profile, nowMs }) {
  // Rule 1: fewer than 3 accepted samples → null
  if (!samples || samples.length < 3) return null;

  const TlimC = profile.maxTempC;
  const T_now = samples[samples.length - 1].tempC;
  const n = samples.length;

  // ── Rule 2: Newton when ambient is known and (ambient - T_now) >= 2 ────────
  if (ambientC != null && ambientC - T_now >= 2) {
    // Attach tH (hours since first sample) to each sample for fitting
    const t0ms = samples[0].timestampMs;
    const fitted = samples.map(s => ({
      tempC: s.tempC,
      tH: (s.timestampMs - t0ms) / 3.6e6,
    }));
    const { k, r2 } = fitNewtonK({ samples: fitted, ambientC });

    if (!isNaN(k) && r2 >= 0.8) {
      // Predict from where the cargo is NOW, not from the first sample in the
      // window. Using samples[0] answers "how long from the start of the
      // window", which has already partly elapsed - so a shipment minutes from
      // breaching could report a time beyond the alerting horizon and stay
      // silent. The operator needs the time they have left.
      const tBreachH = timeToBreachNewton({ k, T0: T_now, TlimC, TambC: ambientC });

      if (tBreachH > BREACH_HORIZON_H) return null;

      let confidence;
      if (r2 >= 0.95 && n >= 6) confidence = 'high';
      else if (r2 >= 0.8)       confidence = 'medium';
      else                       confidence = 'low';

      return {
        method: 'newton',
        tBreachH,
        breachAtMs: nowMs + tBreachH * 3.6e6,
        kPerH: k,
        slopeCPerH: null,
        r2,
        confidence,
        basis: `Newton fit k=${k.toFixed(4)}/h, r²=${r2.toFixed(3)}`,
      };
    }
  }

  // ── Rule 3: slope (EWMA) ──────────────────────────────────────────────────
  const slope = _ewmaSlope(samples);
  if (slope === null || slope <= 0) return null;

  const tBreachH = (TlimC - T_now) / slope;
  if (tBreachH > BREACH_HORIZON_H || tBreachH <= 0) return null;

  let confidence;
  if (n >= 6) confidence = 'medium';
  else        confidence = 'low';

  return {
    method: 'slope',
    tBreachH,
    breachAtMs: nowMs + tBreachH * 3.6e6,
    kPerH: null,
    slopeCPerH: slope,
    r2: null,
    confidence,
    basis: `EWMA slope ${slope.toFixed(4)} °C/h`,
  };
}

module.exports = { predict, timeToBreachNewton, fitNewtonK };
