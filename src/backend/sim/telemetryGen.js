/**
 * sim/telemetryGen.js — sensor readings derived from where a shipment is and
 * what is happening to it, rather than from a coin flip.
 *
 * The old simulator picked a random shipment every 5 s and rolled a 30 % chance
 * of a spike. Nothing about it was connected to the world, so a "temperature
 * excursion" could not be explained, predicted or prevented. Here the reading
 * follows from ambient temperature at the shipment's latitude and local hour,
 * the reefer's state, and any scripted event in play.
 *
 * Thermal model: Newton's law of cooling,
 *   dT/dt = k * (T_ambient - T)
 * with k depending on whether the unit is running (tight control) or the cargo
 * is coasting on insulation alone. The same k the breach predictor fits.
 *
 * PURE: no database, no network, no wall-clock reads. Randomness comes from an
 * injected seeded generator so a run replays identically.
 */
"use strict";

// Cooling/warming coefficients, per hour. [illustrative — calibrated so a
// failed reefer in 30 C ambient breaches 8 C from 4 C in roughly 5.5 hours,
// which matches the breachPredictor anchor case.]
const K = {
  unit_running: 0.9,   // active reefer holding setpoint
  door_open: 0.35,     // doors open at a stop
  unit_fault: 0.03,    // compressor dead, insulation only
  passive: 0.02,       // qualified passive shipper
};

/** Rough ambient at a latitude and local hour. [illustrative] */
function ambientC({ lat, hourOfDay, corridorBiasC = 0 }) {
  const absLat = Math.abs(lat);
  // Warm at the equator, cold at the poles.
  const base = 32 - (absLat / 90) * 45;
  // Diurnal swing, peaking mid-afternoon.
  const diurnal = 6 * Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI);
  return base + diurnal + corridorBiasC;
}

/**
 * One step of the thermal model.
 * @returns {number} the new cargo temperature in C
 */
function stepTemp({ tempC, ambient, kPerH, deltaHours, setpointC, unitRunning }) {
  if (unitRunning) {
    // An active unit pulls toward setpoint, not toward ambient.
    const target = setpointC;
    return tempC + (target - tempC) * (1 - Math.exp(-K.unit_running * deltaHours));
  }
  return ambient + (tempC - ambient) * Math.exp(-kPerH * deltaHours);
}

/**
 * Generate the next reading for a shipment.
 *
 * @param {object} args
 * @param {object} args.state     { tempC, doorOpen, unitMode, powerSource, batteryPct }
 * @param {number} args.lat
 * @param {number} args.simNowMs
 * @param {number} args.deltaHours
 * @param {number} args.setpointC
 * @param {object} [args.event]   scripted event in play, e.g. {kind:"compressor_fault"}
 * @param {function} [args.rand]  seeded RNG returning [0,1)
 * @returns {object} a SensorLog-shaped reading
 */
function nextReading({ state, lat, simNowMs, deltaHours, setpointC, event = null, rand = Math.random, corridorBiasC = 0 }) {
  const hourOfDay = new Date(simNowMs).getUTCHours();
  const ambient = ambientC({ lat, hourOfDay, corridorBiasC });

  let { tempC, doorOpen = false, unitMode = "running", powerSource = "unit_running", batteryPct = 100 } = state;

  // Scripted events override the steady state.
  if (event) {
    if (event.kind === "compressor_fault") { unitMode = "fault"; powerSource = "none"; }
    if (event.kind === "door_open") doorOpen = true;
    if (event.kind === "door_close") doorOpen = false;
    if (event.kind === "power_restored") { unitMode = "running"; powerSource = "unit_running"; }
    if (event.kind === "cold_depot") { unitMode = "running"; powerSource = "cold_depot"; }
  }

  const unitRunning = unitMode === "running" && !doorOpen;
  const kPerH = doorOpen ? K.door_open : unitMode === "fault" ? K.unit_fault : K.passive;

  let next = stepTemp({ tempC, ambient, kPerH, deltaHours, setpointC, unitRunning });

  // Sensor noise, small and seeded. [illustrative]
  next += (rand() - 0.5) * 0.12;

  // Battery drains when the unit is not on external power.
  const nextBattery = powerSource === "none"
    ? Math.max(0, batteryPct - deltaHours * 1.5)
    : Math.min(100, batteryPct + deltaHours * 2);

  return {
    recordedAt: simNowMs,
    temperatureCelsius: Number(next.toFixed(2)),
    ambientC: Number(ambient.toFixed(2)),
    doorOpen,
    unitMode,
    powerSource,
    batteryPct: Number(nextBattery.toFixed(1)),
    kPerH,
  };
}

/** Deterministic RNG (mulberry32) so a seeded run replays identically. */
function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { nextReading, ambientC, stepTemp, seededRng, K };
