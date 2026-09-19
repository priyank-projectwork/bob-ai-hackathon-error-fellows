"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const net = require("./network.js");

describe("network", () => {
  it("every lane resolves to real nodes", () => {
    for (const id of net.listLanes()) {
      assert.doesNotThrow(() => net.laneCoords(id), `lane ${id} has an unknown node`);
    }
  });

  it("every coordinate is valid GeoJSON [lng, lat]", () => {
    for (const [id, n] of Object.entries(net.NODES)) {
      const [lng, lat] = n.coords;
      assert.ok(lng >= -180 && lng <= 180, `${id} lng ${lng}`);
      assert.ok(lat >= -90 && lat <= 90, `${id} lat ${lat}`);
    }
  });

  it("lane coordinates have no duplicated joins between legs", () => {
    const coords = net.laneCoords("IN-KE-SEA");
    for (let i = 1; i < coords.length; i++) {
      assert.ok(
        coords[i][0] !== coords[i - 1][0] || coords[i][1] !== coords[i - 1][1],
        `duplicate point at index ${i}`
      );
    }
  });

  // The hero lane: Pune -> JNPT -> (Jebel Ali) -> Mombasa -> Nairobi
  it("the hero lane is multi-modal and plausibly long", () => {
    const s = net.laneSummary("IN-KE-SEA");
    assert.strictEqual(s.multiModal, true);
    assert.ok(s.modes.includes("Sea") && s.modes.includes("Road"));
    assert.ok(s.distanceKm > 5000 && s.distanceKm < 12000, `got ${s.distanceKm} km`);
    assert.ok(s.transitHours > 150, `got ${s.transitHours} h`);
    assert.ok(s.dwellHours > 0, "ports should contribute dwell");
  });

  it("air beats sea on time and loses on cost and CO2", () => {
    const sea = net.laneSummary("IN-KE-SEA");
    const air = net.laneSummary("IN-KE-AIR");
    assert.ok(air.transitHours < sea.transitHours, "air should be faster");
    assert.ok(air.costUsd > sea.costUsd, "air should cost more");
    assert.ok(air.co2Kg > sea.co2Kg, "air should emit more");
  });

  // The Red Sea question the geopolitical scenario turns on.
  it("the Cape route is longer and slower than Suez", () => {
    const suez = net.laneSummary("IN-NL-SUEZ");
    const cape = net.laneSummary("IN-NL-CAPE");
    assert.ok(cape.distanceKm > suez.distanceKm, "Cape should be the long way round");
    assert.ok(cape.transitHours > suez.transitHours);
  });

  // The toll is charged per vessel transit and shared across the boxes on board.
  // Billing one shipment the whole 465k would make Suez look absurd; the real
  // trade-off is that Suez is shorter and faster but tolled, the Cape is free
  // but 7,000 km longer.
  it("the Suez toll is amortised per container, not charged whole", () => {
    const suez = net.laneSummary("IN-NL-SUEZ");
    const suezNode = net.node("SUEZ");
    assert.strictEqual(suezNode.feeBasis, "vessel");
    const perBox = suezNode.feeUsd / suezNode.amortiseOverTeu;
    assert.ok(perBox > 5 && perBox < 200, `per-container toll ${perBox} is implausible`);
    assert.ok(suez.costUsd < 50000, `one shipment should not carry the whole toll (got ${suez.costUsd})`);
  });

  it("Suez is cheaper and faster than the Cape despite the toll", () => {
    const suez = net.laneSummary("IN-NL-SUEZ");
    const cape = net.laneSummary("IN-NL-CAPE");
    assert.ok(suez.costUsd < cape.costUsd, "the shorter tolled route should still win on cost");
    assert.ok(suez.transitHours < cape.transitHours);
    // ...which is exactly why closing the Red Sea hurts: the cheap fast option
    // disappears and the Cape becomes the only way through.
    assert.ok(cape.distanceKm - suez.distanceKm > 5000, "the Cape detour should be thousands of km");
  });

  it("the trans-Pacific lane crosses the Pacific, not Eurasia", () => {
    const s = net.laneSummary("CN-US-PAC");
    // Shanghai -> LA great circle is ~10,400 km; the wrong way round is ~29,000.
    assert.ok(s.distanceKm < 13000, `got ${s.distanceKm} km — probably wrapped the wrong way`);
  });

  it("two US routes to Denver differ, so there is a real alternative", () => {
    const north = net.laneSummary("US-LAX-DEN");
    const south = net.laneSummary("US-LAX-DEN-SOUTH");
    assert.notStrictEqual(north.distanceKm, south.distanceKm);
  });

  it("graph edges carry mode, cost, hours and coordinates", () => {
    const edges = net.graphEdges();
    assert.ok(edges.length >= 18, `only ${edges.length} edges`);
    for (const e of edges) {
      assert.ok(e.distanceKm > 0, `${e.from}->${e.to} has no distance`);
      assert.ok(e.hours > 0);
      assert.ok(e.costUsd > 0);
      assert.ok(Array.isArray(e.coords) && e.coords.length >= 2);
    }
  });

  it("Bab-el-Mandeb carries elevated base risk", () => {
    const edge = net.graphEdges().find((e) => e.via.includes("BAB"));
    assert.ok(edge, "expected a lane through Bab-el-Mandeb");
    assert.ok(edge.riskBase > 0, "chokepoint should raise base risk");
  });

  it("cold storage and GDP certification are queryable", () => {
    assert.strictEqual(net.node("NBO").coldStorage, true);
    assert.strictEqual(net.node("NBO").gdpCertified, true);
    assert.strictEqual(net.node("KEMBA").gdpCertified, false);
  });
});
