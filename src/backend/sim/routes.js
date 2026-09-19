/**
 * sim/routes.js — HTTP surface for the simulated world.
 *
 * These are the controls behind the time bar in the UI: play, pause, change
 * speed, jump to a moment. `/world` is the snapshot the map renders from, and
 * `/ingest/sensor` is the door real telemetry comes in through, so Live mode
 * uses exactly the same pipeline as Simulate.
 */
"use strict";

const express = require("express");
const motion = require("../engines/motion");

/**
 * @param {object} deps
 * @param {World}    deps.world
 * @param {Function} deps.requireDb
 * @param {Function} deps.loadShipments  async () => shipment docs
 * @param {Function} deps.onIngest       async (reading) => void
 */
function buildSimRouter({ world, requireDb, loadShipments, onIngest }) {
  const r = express.Router();

  r.get("/sim/status", (req, res) => res.json(world.status()));

  r.post("/sim/play", (req, res) => res.json(world.clock.play(Date.now())));

  r.post("/sim/pause", (req, res) => res.json(world.clock.pause()));

  r.post("/sim/speed", (req, res) => {
    const speed = Number(req.body?.speed);
    if (!Number.isFinite(speed) || speed < 0) {
      return res.status(400).json({ error: "speed must be a non-negative number" });
    }
    res.json(world.clock.setSpeed(speed, Date.now()));
  });

  r.post("/sim/seek", (req, res) => {
    const { simMs, hours } = req.body || {};
    if (Number.isFinite(simMs)) return res.json(world.clock.seek(Number(simMs)));
    if (Number.isFinite(hours)) return res.json(world.clock.skipHours(Number(hours)));
    res.status(400).json({ error: "provide simMs or hours" });
  });

  r.post("/sim/reset", (req, res) => res.json(world.clock.reset()));

  /**
   * Snapshot of the moving world: every in-transit shipment with its current
   * position, progress, ETA and the part of its route still ahead.
   */
  r.get("/world", requireDb, async (req, res) => {
    try {
      const simNowMs = world.clock.now();
      const shipments = await loadShipments();
      const out = shipments.map((s) => {
        const coords = s.routeCoords;
        if (!Array.isArray(coords) || coords.length < 2) {
          return {
            shipmentId: s.shipmentId,
            position: s.currentLocation ? [s.currentLocation.lng, s.currentLocation.lat] : null,
            moving: false,
          };
        }
        const st = world.state(s.shipmentId);
        const pos = motion.advance({
          coords,
          departedAtMs: s.departedAtMs,
          nowMs: simNowMs,
          speedKmh: s.speedKmh,
          dwellHours: s.dwellHours ?? 0,
          halted: st.halted,
          haltedAtKm: st.haltedAtKm,
        });
        return {
          shipmentId: s.shipmentId,
          cargoType: s.cargoType,
          priority: s.priority,
          transportMode: s.transportMode,
          position: pos.position,
          bearing: pos.bearing,
          progressKm: Number(pos.progressKm.toFixed(1)),
          totalKm: Number(pos.totalKm.toFixed(1)),
          fractionDone: Number(pos.fractionDone.toFixed(4)),
          etaMs: pos.etaMs,
          arrived: pos.arrived,
          halted: st.halted,
          tempC: st.tempC,
          unitMode: st.unitMode,
          doorOpen: st.doorOpen,
          batteryPct: st.batteryPct,
          remainingPath: motion.remainingPath({ coords, progressKm: pos.progressKm }),
          routeCoords: coords,
          moving: !pos.arrived && !st.halted,
        };
      });
      res.json({ simNowMs, simNowIso: new Date(simNowMs).toISOString(), mode: world.mode, shipments: out });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Real telemetry lands here. Same shape the simulator produces, so Live and
   * Simulate run through one pipeline and one set of engines.
   */
  r.post("/ingest/sensor", requireDb, async (req, res) => {
    try {
      const { shipmentId, temperatureCelsius, recordedAt } = req.body || {};
      if (!shipmentId || !Number.isFinite(Number(temperatureCelsius))) {
        return res.status(400).json({ error: "shipmentId and numeric temperatureCelsius are required" });
      }
      const reading = {
        shipmentId,
        temperatureCelsius: Number(temperatureCelsius),
        recordedAt: Number.isFinite(Number(recordedAt)) ? Number(recordedAt) : world.clock.now(),
        ambientC: req.body.ambientC ?? null,
        doorOpen: Boolean(req.body.doorOpen),
        unitMode: req.body.unitMode ?? "running",
        powerSource: req.body.powerSource ?? "unit_running",
        batteryPct: req.body.batteryPct ?? null,
        source: "ingest",
      };
      if (onIngest) await onIngest(reading);
      res.status(202).json({ accepted: true, shipmentId, recordedAt: reading.recordedAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}

module.exports = { buildSimRouter };
