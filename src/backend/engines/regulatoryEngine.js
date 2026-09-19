/**
 * regulatoryEngine.js
 * Severity classification by rules — never by LLM.
 * Pure functions, no I/O, no Date.now().
 */

// ─── Severity ladder ──────────────────────────────────────────────────────────

const SEVERITY_RANK = { None: 0, Warning: 1, Minor: 2, Major: 3, Critical: 4 };
const SEVERITY_LIST = ['None', 'Warning', 'Minor', 'Major', 'Critical'];

/**
 * Return the higher of two severity strings.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function severityMax(a, b) {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// ─── Severity matrix ──────────────────────────────────────────────────────────
// Columns split at 1 h and 10 h (10 h = WHO PQS heat alarm).
//
//  row      | <1h       | 1-10h     | >=10h
//  freeze   | Warning   | Critical  | Critical
//  cold     | Warning   | Minor     | Major
//  warm     | Warning   | Minor     | Major
//  hot      | Minor     | Major     | Critical
//  extreme  | Major     | Critical  | Critical

const SEVERITY_MATRIX = {
  freeze:  ['Warning',  'Critical', 'Critical'],
  cold:    ['Warning',  'Minor',    'Major'],
  warm:    ['Warning',  'Minor',    'Major'],
  hot:     ['Minor',    'Major',    'Critical'],
  extreme: ['Major',    'Critical', 'Critical'],
};

function _durationColumn(durationMin) {
  if (durationMin < 60) return 0;     // < 1h
  if (durationMin < 600) return 1;    // 1h–10h
  return 2;                           // >= 10h
}

// ─── Mean Kinetic Temperature (USP <1079.2>) ──────────────────────────────────

const DH_OVER_R = 10000; // K [illustrative]

/**
 * Compute the Mean Kinetic Temperature from an array of {tempC, durationMin} samples.
 * MKT is reported only — it never lowers severity and never closes an excursion.
 *
 * @param {Array<{tempC: number, durationMin: number}>} samples
 * @returns {number} MKT in °C
 */
function meanKineticTemp(samples) {
  let numerator = 0;
  let denominator = 0;
  for (const s of samples) {
    const T_K = 273.15 + s.tempC;
    const w = s.durationMin;
    numerator += w * Math.exp(-DH_OVER_R / T_K);
    denominator += w;
  }
  const inner = numerator / denominator;
  const MKT_K = (-DH_OVER_R) / Math.log(inner);
  return MKT_K - 273.15;
}

// ─── classify ─────────────────────────────────────────────────────────────────

/**
 * Classify a temperature excursion.
 *
 * @param {object} p
 * @param {string}  p.bandKey        - 'freeze'|'cold'|'warm'|'hot'|'extreme'
 * @param {number}  p.durationMin    - excursion duration in minutes
 * @param {number}  p.peakC          - peak temperature during excursion
 * @param {number}  p.minC           - minimum temperature during excursion
 * @param {Array}   p.samples        - [{tempC, durationMin}] for MKT
 * @param {object}  p.profile        - cargo profile
 * @param {object}  p.thermal        - {consumedH: {[band]: hours}}
 * @returns {object}
 */
function classify({ bandKey, durationMin, peakC, minC, samples, profile, thermal }) {
  const col = _durationColumn(durationMin);
  const row = SEVERITY_MATRIX[bandKey];
  if (!row) throw new Error(`Unknown band key: ${bandKey}`);

  let severity = row[col];
  const severityCell = severity;

  const rationale = [`Matrix: ${bandKey} band, ${durationMin} min → ${severityCell}`];

  // ── Freeze override ────────────────────────────────────────────────────────
  const freezeCfg = profile.freeze || {};
  const isFreezeRow = bandKey === 'freeze';
  if (isFreezeRow && freezeCfg.sensitive && durationMin >= (freezeCfg.sustainedMin || Infinity)) {
    severity = severityMax(severity, 'Critical');
    rationale.push(`Freeze override: ${durationMin} min >= ${freezeCfg.sustainedMin} min sustained`);
  }

  // ── Cumulative budget rule ─────────────────────────────────────────────────
  // Major at 50 % of band budget consumed, Critical at 100 %.
  const consumedH = (thermal && thermal.consumedH && thermal.consumedH[bandKey]) || 0;
  const budgetH = (profile.bands && profile.bands[bandKey] && profile.bands[bandKey].budgetH) || Infinity;
  const cumulativeFraction = budgetH < Infinity ? consumedH / budgetH : 0;
  if (cumulativeFraction >= 1.0) {
    severity = severityMax(severity, 'Critical');
    rationale.push(`Cumulative: ${Math.round(cumulativeFraction * 100)}% of budget → Critical`);
  } else if (cumulativeFraction >= 0.5) {
    severity = severityMax(severity, 'Major');
    rationale.push(`Cumulative: ${Math.round(cumulativeFraction * 100)}% of budget → Major`);
  }

  // ── MKT ────────────────────────────────────────────────────────────────────
  // MKT applies only when there are samples and the excursion is not a freeze row.
  // MKT is reported only — it never lowers severity, never closes an excursion.
  const mktApplies = !isFreezeRow && samples && samples.length > 0;
  let mkt = null;
  if (mktApplies) {
    mkt = meanKineticTemp(samples);
  }

  const productImpacting = SEVERITY_RANK[severity] >= SEVERITY_RANK['Major'];

  return {
    severity,
    severityCell,
    mkt,
    mktApplies: !!mktApplies,
    cumulativeFraction,
    rationale,
    productImpacting,
  };
}

// ─── requiredRoleFor ──────────────────────────────────────────────────────────

/**
 * Return the minimum role required to close an excursion of this severity.
 * @param {string} severity
 * @returns {string}
 */
function requiredRoleFor(severity) {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK['Major'] ? 'qa_rp' : 'controller';
}

// ─── recommendedDisposition ───────────────────────────────────────────────────

/**
 * Recommended disposition for an excursion.
 * @param {string} severity
 * @returns {string}
 */
function recommendedDisposition(severity) {
  switch (severity) {
    case 'None':    return 'release';
    case 'Warning': return 'release_with_note';
    case 'Minor':   return 'release_with_note';
    case 'Major':   return 'quarantine_qa';
    case 'Critical':return 'reject';
    default:        return 'quarantine_qa';
  }
}

module.exports = {
  classify,
  severityMax,
  requiredRoleFor,
  recommendedDisposition,
  meanKineticTemp,
};
