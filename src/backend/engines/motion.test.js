"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  haversineKm, measure, pointAtKm, advance, remainingPath, normaliseLng, unwrap,
} = require("./motion.js");

const T0 = 1_700_000_000_000; // fixed epoch, never Date.now()

// [lng, lat] — GeoJSON order
const SHANGHAI = [121.47, 31.22];
const LOS_ANGELES = [-118.24, 34.05];
const DENVER = [-104.99, 39.74];
const CHICAGO = [-87.63, 41.88];

describe("motion", () => {
  it("haversine matches a known distance (LA -> Denver ~1340 km)", () => {
    const d = haversineKm(LOS_ANGELES, DENVER);
    assert.ok(Math.abs(d - 1340) < 40, `got ${d}`);
  });

  it("measure sums segment distances", () => {
    const { totalKm } = measure([LOS_ANGELES, DENVER, CHICAGO]);
    const expected = haversineKm(LOS_ANGELES, DENVER) + haversineKm(DENVER, CHICAGO);
    assert.ok(Math.abs(totalKm - expected) < 0.001);
  });

  // The trans-Pacific bug: Shanghai -> LA must cross the Pacific (~10,400 km),
  // not run backwards across Eurasia and the Atlantic (~29,000 km).
  it("crosses the antimeridian the short way", () => {
    const d = haversineKm(SHANGHAI, LOS_ANGELES);
    assert.ok(d < 11500, `great-circle should be ~10,400 km, got ${d}`);

    const mid = pointAtKm([SHANGHAI, LOS_ANGELES], d / 2).position;
    // Halfway across the Pacific the longitude is either beyond +150 or beyond
    // -150 — it must NOT land in Europe/Asia (roughly -100..+100).
    assert.ok(
      mid[0] > 150 || mid[0] < -150,
      `midpoint ${mid} should be mid-Pacific, not over Eurasia`
    );
  });

  it("unwrap keeps consecutive longitudes within 180 degrees", () => {
    const u = unwrap([SHANGHAI, LOS_ANGELES]);
    assert.ok(Math.abs(u[1][0] - u[0][0]) <= 180);
  });

  it("normaliseLng brings unwrapped values back into range", () => {
    // float tolerance: -241.76 + 360 is 118.24000000000001 in IEEE 754
    assert.ok(Math.abs(normaliseLng(-241.76) - 118.24) < 1e-9);
    assert.ok(Math.abs(normaliseLng(200) - -160) < 1e-9);
    assert.ok(Math.abs(normaliseLng(-10) - -10) < 1e-9);
    // range invariant holds for arbitrary input
    for (const v of [-540, -181, 0, 181, 540, 719]) {
      const n = normaliseLng(v);
      assert.ok(n > -180 && n <= 180, `${v} -> ${n} out of range`);
    }
  });

  it("pointAtKm(0) is the origin and pointAtKm(total) is the destination", () => {
    const route = [LOS_ANGELES, DENVER, CHICAGO];
    const { totalKm } = measure(route);
    const start = pointAtKm(route, 0).position;
    const end = pointAtKm(route, totalKm).position;
    assert.ok(Math.abs(start[0] - LOS_ANGELES[0]) < 0.001);
    assert.ok(Math.abs(end[1] - CHICAGO[1]) < 0.001);
  });

  it("clamps beyond the ends rather than overshooting", () => {
    const route = [LOS_ANGELES, DENVER];
    const past = pointAtKm(route, 99999).position;
    assert.ok(Math.abs(past[0] - DENVER[0]) < 0.001);
  });

  it("advance moves at the given speed", () => {
    const route = [LOS_ANGELES, DENVER];
    const r = advance({ coords: route, departedAtMs: T0, nowMs: T0 + 10 * 3.6e6, speedKmh: 80 });
    assert.ok(Math.abs(r.progressKm - 800) < 1, `got ${r.progressKm}`);
    assert.strictEqual(r.arrived, false);
  });

  it("dwell hours delay departure", () => {
    const route = [LOS_ANGELES, DENVER];
    const moving = advance({ coords: route, departedAtMs: T0, nowMs: T0 + 10 * 3.6e6, speedKmh: 80 });
    const dwelt = advance({ coords: route, departedAtMs: T0, nowMs: T0 + 10 * 3.6e6, speedKmh: 80, dwellHours: 4 });
    assert.ok(Math.abs(dwelt.progressKm - 480) < 1, `got ${dwelt.progressKm}`);
    assert.ok(dwelt.progressKm < moving.progressKm);
  });

  it("ETA is now plus remaining distance over speed", () => {
    const route = [LOS_ANGELES, DENVER];
    const now = T0 + 5 * 3.6e6;
    const r = advance({ coords: route, departedAtMs: T0, nowMs: now, speedKmh: 100 });
    const expectedH = r.remainingKm / 100;
    assert.ok(Math.abs((r.etaMs - now) / 3.6e6 - expectedH) < 0.001);
  });

  it("a halted shipment stops moving and has no ETA", () => {
    const route = [LOS_ANGELES, DENVER];
    const r = advance({
      coords: route, departedAtMs: T0, nowMs: T0 + 50 * 3.6e6,
      speedKmh: 80, halted: true, haltedAtKm: 300,
    });
    assert.strictEqual(r.progressKm, 300);
    assert.strictEqual(r.etaMs, null);
  });

  it("arrival is flagged and progress does not exceed the route", () => {
    const route = [LOS_ANGELES, DENVER];
    const { totalKm } = measure(route);
    const r = advance({ coords: route, departedAtMs: T0, nowMs: T0 + 500 * 3.6e6, speedKmh: 80 });
    assert.strictEqual(r.arrived, true);
    assert.ok(Math.abs(r.progressKm - totalKm) < 0.001);
    assert.strictEqual(r.remainingKm, 0);
  });

  // Impact detection must only consider what is still ahead.
  it("remainingPath drops waypoints already passed", () => {
    const route = [LOS_ANGELES, DENVER, CHICAGO];
    const toDenver = haversineKm(LOS_ANGELES, DENVER);
    const rest = remainingPath({ coords: route, progressKm: toDenver + 100 });
    // Denver is behind us; only the head position and Chicago remain.
    assert.strictEqual(rest.length, 2);
    assert.ok(Math.abs(rest[1][0] - CHICAGO[0]) < 0.001);
  });

  it("remainingPath at the start keeps every waypoint", () => {
    const route = [LOS_ANGELES, DENVER, CHICAGO];
    const rest = remainingPath({ coords: route, progressKm: 0 });
    assert.strictEqual(rest.length, 3);
  });
});
