/**
 * services/coldChain.js — the pipeline every temperature reading goes through.
 *
 *   sanity  -> is this reading believable?
 *   bands   -> which band is it in, and for how long?
 *   grade   -> what severity does the rule profile say (never the LLM)
 *   clock   -> how much usable cargo life is left
 *   predict -> will it breach, and when
 *   alert   -> tell someone, once, with the reason
 *
 * The LLM is not consulted for any decision here. It is asked afterwards to
 * put the engine's conclusion into a sentence, and if it is unavailable the
 * pipeline is unaffected.
 */
"use strict";

const Shipment = require("../models/Shipment");
const RuleProfile = require("../models/RuleProfile");
const Excursion = require("../models/Excursion");
const Alert = require("../models/Alert");
const SensorLog = require("../models/SensorLog");

const sanity = require("../engines/sensorSanity");
const regulatory = require("../engines/regulatoryEngine");
const clockEngine = require("../engines/viabilityClock");
const predictor = require("../engines/breachPredictor");
const rootCause = require("../engines/rootCause");

const MIN = 60000;
const H = 3.6e6;

/** Recent readings per shipment, for sanity, prediction and root cause. */
const windows = new Map();
const WINDOW = 24;

function pushWindow(shipmentId, reading) {
  const w = windows.get(shipmentId) ?? [];
  w.push(reading);
  while (w.length > WINDOW) w.shift();
  windows.set(shipmentId, w);
  return w;
}

function getWindow(shipmentId) {
  return windows.get(shipmentId) ?? [];
}

function resetWindows() {
  windows.clear();
}

/** Which band of the profile a temperature falls in. null = in range. */
function bandFor(profile, tempC) {
  if (tempC >= profile.minTempC && tempC <= profile.maxTempC) return null;
  for (const b of profile.bands ?? []) {
    if (tempC >= b.minC && tempC < b.maxC) return b;
  }
  return null;
}

/**
 * Thermal summary the clock needs.
 *
 * packagingHoldRemainingH is what the packaging can still hold for, and it
 * drains with ELAPSED TRANSIT, not with time out of range — an insulated
 * shipper qualified for 96 h has been using those hours since it was sealed.
 *
 * Omitting it was a real defect: viabilityClock fell back to 0, so
 * stabilityMarginH collapsed to the sum of unspent band budgets. A frozen
 * shipment sitting at -19.99 C, dead centre of its -25..-10 range with no
 * excursion, reported 4 h of life and showed as CRITICAL with $88k at risk.
 * Ten shipments sat there permanently.
 */
const LIVE_POWER = new Set([
  "unit_running", "vessel_plug", "terminal_plug", "cold_depot", "bonded_cold_store",
]);

function thermalFrom(excursion, profile, freezeSustainedMin, { departedAtMs, nowMs, powerSource } = {}) {
  const holdQualH = profile?.packaging?.holdQualH ?? 0;
  const passive = profile?.packaging?.kind === "passive_shipper";

  // An ACTIVE reefer's qualified hold time is a reserve, not a countdown: it
  // is what the box can hold for once the power goes. While the unit is
  // running that reserve is intact. Only a passive shipper — or an active one
  // that has lost power — burns it with elapsed time.
  //
  // Draining it unconditionally made every frozen shipment read CRITICAL while
  // sitting at -19.99 C, dead centre of its range, with no excursion at all.
  const onPower = LIVE_POWER.has(powerSource ?? "unit_running");
  const burning = passive || !onPower;
  const elapsedH =
    burning && departedAtMs && nowMs ? Math.max(0, (nowMs - departedAtMs) / 3.6e6) : 0;

  return {
    consumedH: Object.fromEntries(
      Object.entries(excursion?.bandMinutes ?? {}).map(([k, v]) => [k, v / 60])
    ),
    freezeSustainedMin: freezeSustainedMin ?? 0,
    packagingHoldRemainingH: Math.max(0, holdQualH - elapsedH),
  };
}

/**
 * Process one reading end to end.
 * @returns {object} what happened, for the caller to emit
 */
async function processReading(reading, { emit } = {}) {
  const shipment = await Shipment.findOne({ shipmentId: reading.shipmentId }).lean();
  if (!shipment) return { skipped: "unknown shipment" };

  const profile = shipment.tempProfileId
    ? await RuleProfile.findById(shipment.tempProfileId).lean()
    : null;
  if (!profile) return { skipped: "no rule profile" };

  const nowMs = reading.recordedAt ?? Date.now();
  const window = getWindow(reading.shipmentId);
  const prev = window[window.length - 1] ?? null;

  // ── 1. Sanity ───────────────────────────────────────────────────────────
  const verdict = sanity.accept({
    sample: { ...reading, tempC: reading.temperatureCelsius, at: nowMs },
    prev: prev ? { ...prev, tempC: prev.temperatureCelsius, at: prev.recordedAt } : null,
    next: null,
    profile,
  });

  pushWindow(reading.shipmentId, reading);

  const out = { shipmentId: reading.shipmentId, accepted: verdict.accepted, flags: verdict.flags, events: [] };
  if (!verdict.accepted) return out;

  // ── 2. Which band, and open/extend the excursion ────────────────────────
  const band = bandFor(profile, reading.temperatureCelsius);
  let excursion = await Excursion.findOne({ shipmentId: reading.shipmentId, status: "Open" });

  const gapMin = prev ? Math.max(0, (nowMs - prev.recordedAt) / MIN) : 0;

  if (band) {
    // A single out-of-range sample is not an excursion. The profile asks for
    // two consecutive ones (minConsecutiveSamples), which is also what stops a
    // lone door-open blip from raising an alarm nobody should act on. The
    // sanity engine's spike rule needs the NEXT sample to judge, so it cannot
    // help us at open time - this consecutive rule is what does.
    const need = profile.excursionOpen?.minConsecutiveSamples ?? 2;
    const recent = getWindow(reading.shipmentId).slice(-need);
    const consecutiveOut =
      recent.length >= need && recent.every((r) => bandFor(profile, r.temperatureCelsius) !== null);

    if (!excursion && !consecutiveOut) {
      out.flags = [...(out.flags ?? []), "AWAITING_CONFIRMATION"];
      return out;
    }

    if (!excursion) {
      excursion = new Excursion({
        shipmentId: reading.shipmentId,
        ruleProfileId: profile._id,
        ruleProfileRef: { profileKey: profile.profileKey, version: profile.version },
        startedAt: nowMs,
        bandKey: band.key,
        peakTempC: reading.temperatureCelsius,
        minTempC: reading.temperatureCelsius,
        bandMinutes: {},
        custodyCarrier: shipment.carrier,
      });
      out.events.push("excursion_opened");
    }

    const bm = { ...(excursion.bandMinutes ?? {}) };
    bm[band.key] = (bm[band.key] ?? 0) + gapMin;
    excursion.bandMinutes = bm;
    excursion.bandKey = band.key;
    excursion.durationMin = (excursion.durationMin ?? 0) + gapMin;
    excursion.peakTempC = Math.max(excursion.peakTempC ?? -999, reading.temperatureCelsius);
    excursion.minTempC = Math.min(excursion.minTempC ?? 999, reading.temperatureCelsius);

    // ── 3. Grade it — rules, never the model ─────────────────────────────
    const freezeMin = band.kind === "freeze" ? (excursion.bandMinutes.freeze ?? 0) : 0;
    const samples = getWindow(reading.shipmentId).map((r) => ({
      tempC: r.temperatureCelsius,
      durationMin: profile.sensor?.expectedIntervalMin ?? 10,
    }));

    const graded = regulatory.classify({
      bandKey: band.key,
      durationMin: excursion.bandMinutes[band.key] ?? 0,
      peakC: excursion.peakTempC,
      minC: excursion.minTempC,
      samples,
      profile,
      thermal: { freezeSustainedMin: freezeMin },
    });

    const prevSeverity = excursion.severity;
    excursion.severity = graded.severity;
    excursion.severityCell = graded.severityCell;
    excursion.mktC = graded.mkt;
    excursion.mktApplies = graded.mktApplies;
    excursion.cumulativeFraction = graded.cumulativeFraction;
    excursion.rationale = graded.rationale ?? [];
    excursion.productImpacting = graded.productImpacting;
    excursion.irreversible =
      profile.freeze?.sensitive && freezeMin >= (profile.freeze?.sustainedMin ?? Infinity);
    excursion.recommendedDisposition = regulatory.recommendedDisposition(graded.severity);
    excursion.requiredRole = regulatory.requiredRoleFor(graded.severity);

    // ── 4. Why is it happening? ──────────────────────────────────────────
    const rc = rootCause.diagnose({
      window: getWindow(reading.shipmentId).map((r) => ({
        at: r.recordedAt,
        tempC: r.temperatureCelsius,
        ambientC: r.ambientC,
        doorOpen: r.doorOpen,
        unitMode: r.unitMode,
        powerSource: r.powerSource,
        batteryPct: r.batteryPct,
        flags: [],
      })),
      profile,
    });
    excursion.rootCause = rc;

    await excursion.save();

    if (prevSeverity !== graded.severity) out.events.push("excursion_escalated");
    out.excursion = excursion.toObject();
  } else if (excursion) {
    // Two consecutive in-range samples close it.
    const inRangeRun = getWindow(reading.shipmentId)
      .slice(-2)
      .every((r) => bandFor(profile, r.temperatureCelsius) === null);
    if (inRangeRun) {
      excursion.status = "Closed";
      excursion.endedAt = nowMs;
      await excursion.save();
      out.events.push("excursion_closed");
      out.excursion = excursion.toObject();
    }
  }

  // ── 5. The life clock ───────────────────────────────────────────────────
  const openExc = excursion && excursion.status === "Open" ? excursion : null;
  const freezeSustained = openExc?.bandMinutes?.freeze ?? 0;

  const clock = clockEngine.computeClock({
    nowMs,
    needByAtMs: shipment.needByAt ? new Date(shipment.needByAt).getTime() : nowMs + 72 * H,
    predictedEtaAtMs: shipment.eta ? new Date(shipment.eta).getTime() : nowMs + 48 * H,
    profile,
    thermal: thermalFrom(openExc, profile, freezeSustained, {
      departedAtMs: shipment.departedAt ? new Date(shipment.departedAt).getTime() : null,
      nowMs,
      powerSource: reading.powerSource,
    }),
    powerSource: reading.powerSource ?? "unit_running",
  });
  out.clock = clock;

  // ── 6. Will it breach? ──────────────────────────────────────────────────
  const prediction = predictor.predict({
    // breachPredictor reads timestampMs, not at — keep the adapter here rather
    // than loosening the engine, which is the tested side of this boundary.
    samples: getWindow(reading.shipmentId).map((r) => ({
      timestampMs: r.recordedAt,
      at: r.recordedAt,
      tempC: r.temperatureCelsius,
    })),
    ambientC: reading.ambientC ?? null,
    profile,
    nowMs,
  });
  if (prediction) {
    out.prediction = prediction;
    out.events.push("breach_predicted");
  }

  // ── 7. Alerts, coalesced so one problem is one alert ────────────────────
  if (out.events.includes("excursion_opened") || out.events.includes("excursion_escalated")) {
    await raiseAlert({
      shipmentId: reading.shipmentId,
      kind: "excursion",
      severity: excursion.severity,
      title: `${excursion.severity} excursion — ${reading.shipmentId}`,
      message:
        `${reading.temperatureCelsius}°C, ${Math.round(excursion.durationMin)} min in ${excursion.bandKey}. ` +
        `${profile.name} v${profile.version} (${profile.minTempC}–${profile.maxTempC}°C). ` +
        `Cause: ${excursion.rootCause?.code ?? "UNKNOWN"}. ` +
        `Disposition: ${excursion.recommendedDisposition}, signed by ${excursion.requiredRole}.`,
      entityId: excursion._id,
    }, emit);
  }

  if (prediction && prediction.tBreachH <= 2) {
    await raiseAlert({
      shipmentId: reading.shipmentId,
      kind: "breach_predicted",
      severity: "High",
      title: `Breach predicted — ${reading.shipmentId}`,
      message:
        `Predicted to exceed ${profile.maxTempC}°C in ${(prediction.tBreachH * 60).toFixed(0)} min ` +
        `(${prediction.method}, confidence ${prediction.confidence}). Life clock ${clock.lifeClockH.toFixed(1)} h.`,
      entityId: reading.shipmentId,
    }, emit);
  }

  return out;
}

/**
 * Excursion severities (Warning/Minor/Major/Critical) and alert severities
 * (Watch/High/Critical) are different ladders — one grades the cargo, the
 * other grades how loudly to shout. Map once, in one place.
 */
function alertSeverityFor(excursionSeverity) {
  switch (excursionSeverity) {
    case "Critical": return "Critical";
    case "Major": return "High";
    case "High": return "High";
    case "Minor": return "Watch";
    case "Warning": return "Watch";
    default: return "Normal";
  }
}

/** One open alert per problem: repeats update rather than pile up. */
async function raiseAlert({ shipmentId, kind, severity, title, message, entityId }, emit) {
  const mapped = alertSeverityFor(severity);
  const coalesceKey = `SHIP:${shipmentId}:${kind}`;
  const existing = await Alert.findOne({ coalesceKey, status: { $ne: "Resolved" } });
  if (existing) {
    existing.severity = mapped;
    existing.title = title;
    existing.message = message;
    existing.repeatCount = (existing.repeatCount ?? 0) + 1;
    await existing.save();
    if (emit) emit("telemetry.alert", existing.toObject());
    return existing;
  }
  const alert = await Alert.create({
    severity: mapped,
    entityType: "Excursion",
    entityId,
    title,
    message,
    coalesceKey,
  });
  if (emit) emit("telemetry.alert", alert.toObject());
  return alert;
}

/** The life clock for one shipment, computed on demand. */
/**
 * @param {object} [opts.predictedEtaAtMs] live ETA from the motion engine.
 *   Without it the schedule clock reads the ETA written once at seed time, so
 *   "until late" never moves and the binding-constraint badge can name the
 *   wrong clock — which is the product's entire argument.
 */
async function lifeClockFor(shipmentId, nowMs, opts = {}) {
  const shipment = await Shipment.findOne({ shipmentId }).lean();
  if (!shipment) return null;
  const profile = shipment.tempProfileId ? await RuleProfile.findById(shipment.tempProfileId).lean() : null;
  if (!profile) return null;

  const openExc = await Excursion.findOne({ shipmentId, status: "Open" }).lean();
  const w = getWindow(shipmentId);
  const last = w[w.length - 1];

  const clock = clockEngine.computeClock({
    nowMs,
    needByAtMs: shipment.needByAt ? new Date(shipment.needByAt).getTime() : nowMs + 72 * H,
    predictedEtaAtMs:
      opts.predictedEtaAtMs ??
      (shipment.eta ? new Date(shipment.eta).getTime() : nowMs + 48 * H),
    profile,
    thermal: thermalFrom(openExc, profile, openExc?.bandMinutes?.freeze ?? 0, {
      departedAtMs: shipment.departedAt ? new Date(shipment.departedAt).getTime() : null,
      nowMs,
      powerSource: last?.powerSource ?? "unit_running",
    }),
    powerSource: last?.powerSource ?? "unit_running",
  });

  const financials = clockEngine.financials({
    lifeClockAtDeliveryH: clock.lifeClockH,
    declaredValueUsd: shipment.declaredValueUsd ?? shipment.cargoValue ?? 0,
    doses: shipment.doses ?? 0,
  });

  return {
    shipmentId,
    profile: { key: profile.profileKey, version: profile.version, name: profile.name, rangeC: [profile.minTempC, profile.maxTempC] },
    tempC: last?.temperatureCelsius ?? null,
    ...clock,
    ...financials,
    openExcursionId: openExc?._id ?? null,
    severity: openExc?.severity ?? "None",
  };
}

module.exports = { processReading, lifeClockFor, getWindow, resetWindows, bandFor, alertSeverityFor };
