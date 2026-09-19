/**
 * sim/clock.js — the simulated clock.
 *
 * Everything in the product reads time from here, never from Date.now(), so a
 * run can be paused, accelerated, rewound and replayed. This is the one object
 * allowed to touch the wall clock, and it does so only to measure how much real
 * time has passed since the last tick.
 *
 * simNow = epochAtStart + (accumulated simulated milliseconds)
 */
"use strict";

class SimClock {
  /**
   * @param {object} opts
   * @param {number} opts.startMs  simulated epoch the run begins at
   * @param {number} [opts.speed]  simulated seconds per real second (1 = real time)
   */
  constructor({ startMs, speed = 60 }) {
    this._startMs = startMs;
    this._simMs = startMs;
    this._speed = speed;
    this._running = false;
    this._lastRealMs = null;
  }

  /** Advance the simulated clock by however much real time has elapsed. */
  tick(realNowMs) {
    if (!this._running) {
      this._lastRealMs = realNowMs;
      return this._simMs;
    }
    if (this._lastRealMs === null) this._lastRealMs = realNowMs;
    const realDelta = realNowMs - this._lastRealMs;
    this._lastRealMs = realNowMs;
    this._simMs += realDelta * this._speed;
    return this._simMs;
  }

  now() {
    return this._simMs;
  }

  play(realNowMs) {
    this._running = true;
    this._lastRealMs = realNowMs;
    return this.status();
  }

  pause() {
    this._running = false;
    return this.status();
  }

  /** Change speed without losing position. */
  setSpeed(speed, realNowMs) {
    this.tick(realNowMs); // bank progress at the old speed first
    this._speed = Math.max(0, Math.min(speed, 3600));
    return this.status();
  }

  /** Jump to an absolute simulated moment. */
  seek(simMs) {
    this._simMs = simMs;
    return this.status();
  }

  /** Jump forward or back by a number of simulated hours. */
  skipHours(hours) {
    this._simMs += hours * 3.6e6;
    return this.status();
  }

  reset(startMs) {
    this._startMs = startMs ?? this._startMs;
    this._simMs = this._startMs;
    this._running = false;
    this._lastRealMs = null;
    return this.status();
  }

  status() {
    return {
      simNowMs: this._simMs,
      simNowIso: new Date(this._simMs).toISOString(),
      startMs: this._startMs,
      elapsedSimHours: (this._simMs - this._startMs) / 3.6e6,
      speed: this._speed,
      running: this._running,
    };
  }
}

module.exports = { SimClock };
