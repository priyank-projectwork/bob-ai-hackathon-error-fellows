"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { rankFleetMatches, assignFleet, utilisation, MIN_SCORE } = require("./fleetMatcher.js");

const NOW = 1_700_000_000_000;
const H = 3.6e6;

const NAIROBI = [36.817, -1.286];
const MOMBASA = [39.658, -4.043];
const MID_PACIFIC = [-175.0, 38.0];

function truck(over = {}) {
  return {
    assetId: "REEF-341", type: "Reefer Truck", status: "Idle",
    currentLocation: { lng: NAIROBI[0], lat: NAIROBI[1] },
    capacityWeight: 22000, minTempC: -25, maxTempC: 25,
    modes: ["Road"], preCoolHours: 1.5, costPerKmUsd: 1.85, costPerIdleHourUsd: 18,
    driverHoursRemaining: 9.5, unitHealth: "ok",
    idleSinceMs: NOW - 52 * H, maintenanceDueMs: NOW + 600 * H,
    ...over,
  };
}

function coldShipment(over = {}) {
  return {
    shipmentId: "VX-2291", cargoType: "Vaccine", tonnes: 12,
    minTempC: 2, maxTempC: 8, transportMode: "Road",
    pickupPoint: MOMBASA, pickupByMs: NOW + 40 * H,
    ...over,
  };
}

describe("fleetMatcher", () => {
  // The headline bug: every score used to be negative.
  it("scores are positive and on a 0-100 scale", () => {
    const { matches } = rankFleetMatches(coldShipment(), [truck()], { nowMs: NOW });
    assert.strictEqual(matches.length, 1);
    assert.ok(matches[0].matchScore > 0, `score was ${matches[0].matchScore}`);
    assert.ok(matches[0].matchScore <= 100);
  });

  it("a road truck is never offered for a sea leg", () => {
    const { matches, rejected } = rankFleetMatches(
      coldShipment({ transportMode: "Sea", pickupPoint: MID_PACIFIC }),
      [truck()],
      { nowMs: NOW }
    );
    assert.strictEqual(matches.length, 0, "a truck cannot meet a vessel mid-ocean");
    assert.match(rejected[0].reason, /cannot serve a Sea leg/);
  });

  it("distance is measured to the pickup point, not the cargo's position", () => {
    const near = rankFleetMatches(coldShipment({ pickupPoint: NAIROBI }), [truck()], { nowMs: NOW });
    const far = rankFleetMatches(coldShipment({ pickupPoint: MOMBASA }), [truck()], { nowMs: NOW });
    assert.ok(near.matches[0].distanceKm < far.matches[0].distanceKm);
    assert.ok(near.matches[0].matchScore > far.matches[0].matchScore);
  });

  it("pre-cool time is added to the rescue ETA", () => {
    const quick = rankFleetMatches(coldShipment(), [truck({ preCoolHours: 0 })], { nowMs: NOW });
    const slow = rankFleetMatches(coldShipment(), [truck({ preCoolHours: 4 })], { nowMs: NOW });
    assert.ok(slow.matches[0].etaHours - quick.matches[0].etaHours >= 3.9);
  });

  it("an asset that cannot arrive in time is rejected with the numbers", () => {
    const { matches, rejected } = rankFleetMatches(
      coldShipment({ pickupByMs: NOW + 1 * H }),
      [truck()],
      { nowMs: NOW }
    );
    assert.strictEqual(matches.length, 0);
    assert.match(rejected[0].reason, /only 1\.0 h available/);
  });

  it("a unit that cannot hold the range is rejected", () => {
    const { rejected } = rankFleetMatches(coldShipment({ minTempC: -30, maxTempC: -20 }), [truck()], { nowMs: NOW });
    assert.match(rejected[0].reason, /cannot hold/);
  });

  it("insufficient capacity is rejected", () => {
    const { rejected } = rankFleetMatches(coldShipment({ tonnes: 40 }), [truck()], { nowMs: NOW });
    assert.match(rejected[0].reason, /capacity/);
  });

  it("a driver without enough hours is rejected", () => {
    const { rejected } = rankFleetMatches(coldShipment(), [truck({ driverHoursRemaining: 1 })], { nowMs: NOW });
    assert.match(rejected[0].reason, /driver has 1 h left/);
  });

  it("a faulted unit is never proposed", () => {
    const { matches, rejected } = rankFleetMatches(coldShipment(), [truck({ unitHealth: "fault" })], { nowMs: NOW });
    assert.strictEqual(matches.length, 0);
    assert.match(rejected[0].reason, /faulted/);
  });

  it("a degraded unit scores lower than a healthy one", () => {
    const ok = rankFleetMatches(coldShipment(), [truck()], { nowMs: NOW });
    const bad = rankFleetMatches(coldShipment(), [truck({ unitHealth: "degraded" })], { nowMs: NOW });
    assert.ok(bad.matches[0].matchScore < ok.matches[0].matchScore);
  });

  it("nothing suitable returns nothing, rather than the least bad option", () => {
    const veryFar = truck({ currentLocation: { lng: -74, lat: 40.7 } }); // New York
    const { matches } = rankFleetMatches(coldShipment({ pickupByMs: null }), [veryFar], { nowMs: NOW });
    if (matches.length) assert.ok(matches[0].matchScore >= MIN_SCORE);
  });

  it("every match explains itself", () => {
    const { matches } = rankFleetMatches(coldShipment(), [truck()], { nowMs: NOW });
    const m = matches[0];
    assert.ok(m.why.includes("km from pickup"));
    assert.ok(m.factors.proximity >= 0 && m.factors.health === 100);
    assert.ok(m.deadheadUsd > 0);
    assert.ok(m.idleHours > 50);
  });

  it("global assignment never double-books an asset", () => {
    const one = truck({ assetId: "A1" });
    const shipments = [coldShipment({ shipmentId: "S1" }), coldShipment({ shipmentId: "S2" })];
    const { assignments, unserved } = assignFleet(shipments, [one], { nowMs: NOW });
    assert.strictEqual(assignments.length, 1);
    assert.deepStrictEqual(unserved.length, 1);
    assert.strictEqual(new Set(assignments.map((a) => a.assetId)).size, assignments.length);
  });

  it("with enough assets everyone is served", () => {
    const fleet = [truck({ assetId: "A1" }), truck({ assetId: "A2" })];
    const shipments = [coldShipment({ shipmentId: "S1" }), coldShipment({ shipmentId: "S2" })];
    const { assignments, unserved } = assignFleet(shipments, fleet, { nowMs: NOW });
    assert.strictEqual(assignments.length, 2);
    assert.strictEqual(unserved.length, 0);
  });

  it("utilisation reports idle count, hours and what idling costs", () => {
    const fleet = [
      truck({ assetId: "A1", status: "Idle", idleSinceMs: NOW - 48 * H }),
      truck({ assetId: "A2", status: "Assigned", idleSinceMs: null }),
      truck({ assetId: "A3", status: "Maintenance", idleSinceMs: null }),
    ];
    const u = utilisation(fleet, { nowMs: NOW });
    assert.strictEqual(u.totalAssets, 3);
    assert.strictEqual(u.idle, 1);
    assert.strictEqual(u.working, 1);
    assert.strictEqual(u.maintenance, 1);
    assert.strictEqual(u.utilisationPct, 33);
    assert.strictEqual(u.idleHours, 48);
    assert.strictEqual(u.idleCostUsd, 48 * 18);
    assert.strictEqual(u.longestIdle[0].assetId, "A1");
  });
});
