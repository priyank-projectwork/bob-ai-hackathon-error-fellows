/**
 * sensorSanity.js
 * Sensor data quality gate — decides which readings other engines may trust.
 * Pure functions, no I/O, no Date.now().
 * Every function that needs "now" takes nowMs as an explicit parameter.
 */

// Default sensor profile values [illustrative]
const DEFAULTS = {
  expectedIntervalMin: 10,   // [illustrative]
  silenceMultiplier:   3,    // [illustrative]  → 30 min threshold
  escalateMultiplier:  6,    // [illustrative]  → 60 min threshold
  spikeDeltaC:         3,    // [illustrative]
  stuckSamples:        6,    // [illustrative]
};

function _sensorCfg(profile) {
  return Object.assign({}, DEFAULTS, (profile && profile.sensor) || {});
}

// ─── accept ───────────────────────────────────────────────────────────────────

/**
 * Decide whether to accept a single sample.
 *
 * NOTE: Single-spike detection is inherently one sample late — we can only judge
 * a spike after seeing the next neighbour. This is correct and documented here.
 *
 * @param {object} p
 * @param {object}  p.sample   - {tempC, timestampMs, batteryPct?}
 * @param {object}  p.prev     - previous accepted sample (or null)
 * @param {object}  p.next     - next sample (look-ahead, or null)
 * @param {object}  p.profile  - cargo profile (with optional .sensor sub-object)
 * @returns {{ accepted: boolean, flags: string[] }}
 */
function accept({ sample, prev, next, profile }) {
  const cfg = _sensorCfg(profile);
  const flags = [];

  // Out-of-order: sample older than the last accepted
  if (prev && sample.timestampMs < prev.timestampMs) {
    flags.push('OUT_OF_ORDER');
    return { accepted: false, flags };
  }

  // Battery flags
  if (sample.batteryPct != null) {
    if (sample.batteryPct < 5) {
      flags.push('LOW_BATTERY');
      // silence will not escalate (handled in silenceCheck via batteryPct context)
    } else if (sample.batteryPct < 20) {
      flags.push('LOW_BATTERY');
    }
  }

  // Single-spike detection: deviates > spikeDeltaC from BOTH neighbours,
  // and neighbours agree within 0.5 °C.
  // Necessarily judges one sample late (correct — we need the next reading).
  if (prev && next) {
    const neighbourDiff = Math.abs(prev.tempC - next.tempC);
    const diffFromPrev  = Math.abs(sample.tempC - prev.tempC);
    const diffFromNext  = Math.abs(sample.tempC - next.tempC);
    if (
      neighbourDiff <= 0.5 &&
      diffFromPrev > cfg.spikeDeltaC &&
      diffFromNext > cfg.spikeDeltaC
    ) {
      flags.push('SPIKE');
      return { accepted: false, flags };
    }
  }

  return { accepted: true, flags };
}

// ─── silenceCheck ─────────────────────────────────────────────────────────────

/**
 * Check whether the sensor has been silent for too long.
 *
 * @param {object} p
 * @param {number}  p.lastAcceptedAtMs  - epoch ms of last accepted sample
 * @param {number}  p.nowMs             - current epoch ms (never Date.now())
 * @param {object}  p.profile
 * @param {string}  p.legMode           - e.g. "Sea" | "Air" | "Road"
 * @param {boolean} p.expectBlackout    - known connectivity blackout?
 * @param {number}  [p.batteryPct]      - latest battery percentage (optional)
 * @returns {null | { kind: "SENSOR_SILENT", minutesSilent: number, escalate: boolean }}
 */
function silenceCheck({ lastAcceptedAtMs, nowMs, profile, legMode, expectBlackout, batteryPct }) {
  const cfg = _sensorCfg(profile);
  const minutesSilent = (nowMs - lastAcceptedAtMs) / 60000;

  // Sea-leg blackout: threshold becomes 72 h
  const seaBlackout = legMode === 'Sea' && expectBlackout;
  const silenceThresholdMin = seaBlackout ? 72 * 60 : cfg.silenceMultiplier * cfg.expectedIntervalMin;
  const escalateThresholdMin = seaBlackout ? 72 * 60 : cfg.escalateMultiplier * cfg.expectedIntervalMin;

  if (minutesSilent <= silenceThresholdMin) return null;

  // Below 5 % battery → silence does not escalate
  const criticalBattery = batteryPct != null && batteryPct < 5;
  const escalate = !criticalBattery && minutesSilent >= escalateThresholdMin;

  return { kind: 'SENSOR_SILENT', minutesSilent, escalate };
}

// ─── stuckCheck ───────────────────────────────────────────────────────────────

/**
 * Return true if the last N readings are identical (sensor stuck).
 *
 * @param {object} p
 * @param {Array}   p.samples  - most-recent accepted samples [{tempC, ...}]
 * @param {object}  p.profile
 * @returns {boolean}
 */
function stuckCheck({ samples, profile }) {
  const cfg = _sensorCfg(profile);
  if (samples.length < cfg.stuckSamples) return false;
  const recent = samples.slice(-cfg.stuckSamples);
  const first = recent[0].tempC;
  return recent.every(s => s.tempC === first);
}

module.exports = { accept, silenceCheck, stuckCheck };
