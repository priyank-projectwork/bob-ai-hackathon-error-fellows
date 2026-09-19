/**
 * rootCause.js
 * Rules-based root-cause diagnosis of temperature excursions.
 * Pure functions, no I/O, no LLM, no Date.now().
 */

// ─── Helper: format a timestamp (epoch ms) as HH:MM ─────────────────────────

function _hhmm(ms) {
  const d = new Date(ms); // OK — constructing from an explicit value, not reading the clock
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ─── diagnose ────────────────────────────────────────────────────────────────

/**
 * Diagnose the most likely root cause from the 30-minute window before the event.
 *
 * Codes (in priority order):
 *   DOOR_OPEN         – door open during planned stop, rising temp, unit running
 *   COMPRESSOR_FAULT  – unitMode === "fault", door closed, battery healthy
 *   POWER_LOSS        – powerSource changed to none/unplugged, unit not running
 *   AMBIENT_HEAT      – unit running, door closed, ambient >10 °C above max, slow rise
 *   PASSIVE_EXPIRED   – passive shipper past its qualified hold time
 *   SENSOR_SUSPECT    – sanity flags dominate the window
 *   UNKNOWN           – nothing matched
 *
 * @param {object} p
 * @param {Array}   p.window   - array of telemetry snapshots (most-recent last), each:
 *                               { timestampMs, tempC, doorOpen?, unitMode?, powerSource?,
 *                                 ambientC?, batteryPct?, sanityFlags?: string[],
 *                                 passiveExpired?, plannedStop? }
 * @param {object}  p.profile  - cargo profile { maxTempC, ... }
 * @returns {{ code: string, evidence: string[], confidence: string }}
 */
function diagnose({ window: win, profile }) {
  const evidence = [];

  if (!win || win.length === 0) {
    return { code: 'UNKNOWN', evidence: [], confidence: 'low' };
  }

  // ── SENSOR_SUSPECT: if >50 % of entries have sanity flags ──────────────
  const flaggedCount = win.filter(s => s.sanityFlags && s.sanityFlags.length > 0).length;
  if (flaggedCount / win.length > 0.5) {
    for (const s of win) {
      if (s.sanityFlags && s.sanityFlags.length > 0) {
        evidence.push(`sanityFlags=${s.sanityFlags.join('+')} at ${_hhmm(s.timestampMs)}`);
      }
    }
    return { code: 'SENSOR_SUSPECT', evidence, confidence: 'medium' };
  }

  // ── DOOR_OPEN: door flag true during a planned stop, temp rising, unit running
  const doorOpenEntries = win.filter(s => s.doorOpen && s.plannedStop && s.unitMode === 'running');
  if (doorOpenEntries.length > 0) {
    // confirm temp is rising
    const rising = _isRising(win);
    if (rising) {
      for (const s of doorOpenEntries) {
        evidence.push(`doorOpen=true at ${_hhmm(s.timestampMs)}`);
      }
      return { code: 'DOOR_OPEN', evidence, confidence: 'high' };
    }
  }

  // ── COMPRESSOR_FAULT: unitMode === "fault", door closed, battery healthy ──
  const faultEntries = win.filter(
    s => s.unitMode === 'fault' && !s.doorOpen && (s.batteryPct == null || s.batteryPct >= 20)
  );
  if (faultEntries.length > 0) {
    for (const s of faultEntries) {
      evidence.push(`unitMode=fault at ${_hhmm(s.timestampMs)}`);
    }
    return { code: 'COMPRESSOR_FAULT', evidence, confidence: 'high' };
  }

  // ── POWER_LOSS: powerSource changed to none/unplugged, unit not running ───
  const powerLossEntries = win.filter(
    s => (s.powerSource === 'none' || s.powerSource === 'unplugged') &&
         s.unitMode !== 'running'
  );
  if (powerLossEntries.length > 0) {
    // Check that the first entry had a different (active) power source
    const first = win[0];
    if (first && first.powerSource && first.powerSource !== 'none' && first.powerSource !== 'unplugged') {
      for (const s of powerLossEntries) {
        evidence.push(`powerSource=${s.powerSource} at ${_hhmm(s.timestampMs)}`);
      }
      return { code: 'POWER_LOSS', evidence, confidence: 'high' };
    }
    // Even without the contrast, flag it
    for (const s of powerLossEntries) {
      evidence.push(`powerSource=${s.powerSource} at ${_hhmm(s.timestampMs)}`);
    }
    return { code: 'POWER_LOSS', evidence, confidence: 'medium' };
  }

  // ── AMBIENT_HEAT: unit running, door closed, ambient >10 °C above max, slow rise
  const maxTempC = (profile && profile.maxTempC) != null ? profile.maxTempC : 8; // [illustrative]
  const ambientEntries = win.filter(
    s => s.unitMode === 'running' && !s.doorOpen &&
         s.ambientC != null && s.ambientC > maxTempC + 10
  );
  if (ambientEntries.length > 0 && _isSlowRise(win)) {
    for (const s of ambientEntries) {
      evidence.push(`ambientC=${s.ambientC} at ${_hhmm(s.timestampMs)}`);
    }
    return { code: 'AMBIENT_HEAT', evidence, confidence: 'medium' };
  }

  // ── PASSIVE_EXPIRED ───────────────────────────────────────────────────────
  const passiveEntries = win.filter(s => s.passiveExpired === true);
  if (passiveEntries.length > 0) {
    for (const s of passiveEntries) {
      evidence.push(`passiveExpired=true at ${_hhmm(s.timestampMs)}`);
    }
    return { code: 'PASSIVE_EXPIRED', evidence, confidence: 'medium' };
  }

  return { code: 'UNKNOWN', evidence: [], confidence: 'low' };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _isRising(win) {
  if (win.length < 2) return false;
  return win[win.length - 1].tempC > win[0].tempC;
}

function _isSlowRise(win) {
  if (win.length < 2) return false;
  const dt = (win[win.length - 1].timestampMs - win[0].timestampMs) / 3.6e6; // hours
  const dT = win[win.length - 1].tempC - win[0].tempC;
  if (dt <= 0) return false;
  const rateCPerH = dT / dt;
  return rateCPerH > 0 && rateCPerH < 5; // [illustrative] slow = <5 °C/h
}

module.exports = { diagnose };
