/**
 * sim/world.js — the thing that makes the map move.
 *
 * On every tick it advances the simulated clock, moves each in-transit
 * shipment along its route, generates a sensor reading from where that
 * shipment now is, and hands the reading to whatever consumer is wired in
 * (the cold-chain pipeline in Live and Simulate, the recorder in record mode).
 *
 * Three modes share this loop:
 *   live     — readings arrive from POST /ingest/sensor, the loop only moves things
 *   simulate — readings are generated here
 *   replay   — readings are read back from a recording, engines unchanged
 */
"use strict";

const { SimClock } = require("./clock");
const { nextReading, seededRng } = require("./telemetryGen");
const motion = require("../engines/motion");

const TICK_MS = 1000; // real-time cadence of the loop

class World {
  constructor({ startMs, speed = 60, seed = 42, mode = "simulate" }) {
    this.clock = new SimClock({ startMs, speed });
    this.mode = mode;
    this.seed = seed;
    this.rand = seededRng(seed);
    this._timer = null;
    this._states = new Map(); // shipmentId -> reefer state
    this._events = [];        // scripted events, sorted by simMinute
    this._onReading = null;
    this._onTick = null;
    this._loadShipments = async () => [];
    this._lastReadingAt = new Map();
    this.readingIntervalMin = 10; // matches profile.sensor.expectedIntervalMin
  }

  /** Wire the data source and the consumers. */
  configure({ loadShipments, onReading, onTick }) {
    if (loadShipments) this._loadShipments = loadShipments;
    if (onReading) this._onReading = onReading;
    if (onTick) this._onTick = onTick;
    return this;
  }

  loadScenario(scenario) {
    this._events = [...(scenario?.events ?? [])].sort((a, b) => a.atSimMinute - b.atSimMinute);
    this._firedEvents = new Set();
    return this;
  }

  /** Events whose simulated minute has arrived and that have not fired yet. */
  _dueEvents(simNowMs) {
    const elapsedMin = (simNowMs - this.clock.status().startMs) / 60000;
    const due = [];
    for (let i = 0; i < this._events.length; i++) {
      const e = this._events[i];
      if (e.atSimMinute <= elapsedMin && !this._firedEvents.has(i)) {
        this._firedEvents.add(i);
        due.push(e);
      }
    }
    return due;
  }

  state(shipmentId) {
    if (!this._states.has(shipmentId)) {
      this._states.set(shipmentId, {
        tempC: 4,
        doorOpen: false,
        unitMode: "running",
        powerSource: "unit_running",
        batteryPct: 100,
        halted: false,
        haltedAtKm: null,
      });
    }
    return this._states.get(shipmentId);
  }

  /** One step of the world. Exposed so tests can drive it without timers. */
  async step(realNowMs) {
    const simNowMs = this.clock.tick(realNowMs);
    if (!this.clock.status().running) return { simNowMs, moved: 0, readings: 0 };

    const events = this._dueEvents(simNowMs);
    const eventsByShipment = new Map();
    for (const e of events) {
      if (e.shipmentId) eventsByShipment.set(e.shipmentId, e);
    }

    const shipments = await this._loadShipments();
    let readings = 0;

    for (const s of shipments) {
      const coords = s.routeCoords;
      if (!Array.isArray(coords) || coords.length < 2) continue;

      const st = this.state(s.shipmentId);
      const event = eventsByShipment.get(s.shipmentId) ?? null;
      if (event?.kind === "hold") { st.halted = true; }
      if (event?.kind === "resume") { st.halted = false; st.haltedAtKm = null; }

      const pos = motion.advance({
        coords,
        departedAtMs: s.departedAtMs,
        nowMs: simNowMs,
        speedKmh: s.speedKmh,
        dwellHours: s.dwellHours ?? 0,
        halted: st.halted,
        haltedAtKm: st.haltedAtKm,
      });

      if (st.halted && st.haltedAtKm === null) st.haltedAtKm = pos.progressKm;

      s.livePosition = pos;

      // Generate a reading every readingIntervalMin of simulated time.
      if (this.mode === "simulate") {
        const last = this._lastReadingAt.get(s.shipmentId) ?? simNowMs - this.readingIntervalMin * 60000;
        const gapMin = (simNowMs - last) / 60000;
        if (gapMin >= this.readingIntervalMin) {
          const reading = nextReading({
            state: st,
            lat: pos.position[1],
            simNowMs,
            deltaHours: gapMin / 60,
            setpointC: s.setpointC ?? 4,
            event,
            rand: this.rand,
            corridorBiasC: s.corridorBiasC ?? 0,
          });
          st.tempC = reading.temperatureCelsius;
          st.doorOpen = reading.doorOpen;
          st.unitMode = reading.unitMode;
          st.powerSource = reading.powerSource;
          st.batteryPct = reading.batteryPct;
          this._lastReadingAt.set(s.shipmentId, simNowMs);
          readings++;
          if (this._onReading) {
            await this._onReading({ shipmentId: s.shipmentId, ...reading, position: pos.position });
          }
        }
      }
    }

    if (this._onTick) await this._onTick({ simNowMs, shipments, events });
    return { simNowMs, moved: shipments.length, readings };
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.step(Date.now()).catch((err) => console.error("[world] tick error:", err.message));
    }, TICK_MS);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  status() {
    return { ...this.clock.status(), mode: this.mode, seed: this.seed, tracked: this._states.size };
  }
}

module.exports = { World, TICK_MS };
