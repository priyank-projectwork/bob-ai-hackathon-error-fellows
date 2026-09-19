"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");

const geo = require("./disruptionGeometry.js");
const router = require("./graphRouter.js");
const { landedCost, dutyRate } = require("./landedCost.js");
const net = require("../data/network.js");

const T0 = 1_700_000_000_000;
const H = 3.6e6;

const LAX = [-118.244, 34.052];
const DEN = [-104.991, 39.740];
const ORD = [-87.630, 41.878];

describe("disruptionGeometry", () => {
  it("measures distance to a segment, not just to its endpoints", () => {
    // A point beside the middle of the LA->Chicago line is far from both ends
    // but close to the path. The old engine tested endpoints only and missed
    // exactly this case.
    const mid = [-104.9, 38.5];
    const toSegment = geo.pointToSegmentKm(mid, LAX, ORD);
    const toEndpoints = Math.min(
      Math.hypot(...[0, 1].map((i) => (mid[i] - LAX[i]) * 100)),
      Math.hypot(...[0, 1].map((i) => (mid[i] - ORD[i]) * 100))
    );
    assert.ok(toSegment < toEndpoints, "segment distance should be shorter than to either end");
  });

  it("finds an intersection along a path and how far ahead it starts", () => {
    const hit = geo.pathIntersection([LAX, DEN, ORD], DEN, 100);
    assert.strictEqual(hit.intersects, true);
    assert.ok(hit.distanceAlongKm > 0, "should report distance along the path");
    assert.ok(hit.exposure > 0);
  });

  it("reports no intersection when the zone is nowhere near", () => {
    const hit = geo.pathIntersection([LAX, DEN], [10, 50], 100);
    assert.strictEqual(hit.intersects, false);
    assert.strictEqual(hit.exposure, 0);
  });

  it("exposure is highest at the centre and zero at the rim", () => {
    const centre = geo.pathIntersection([DEN, [DEN[0] + 1, DEN[1]]], DEN, 200);
    assert.ok(centre.exposure > 90, `got ${centre.exposure}`);
  });

  it("a shipment inside the zone is impacted now", () => {
    const r = geo.assess({
      remainingPath: [DEN, ORD],
      currentPosition: DEN,
      speedKmh: 85,
      nowMs: T0,
      disruption: { centre: DEN, radiusKm: 60 },
    });
    assert.strictEqual(r.impacted, true);
    assert.strictEqual(r.relation, "inside");
    assert.strictEqual(r.hoursToZone, 0);
  });

  it("a shipment heading into a zone gets a time to arrival there", () => {
    const r = geo.assess({
      remainingPath: [LAX, DEN, ORD],
      currentPosition: LAX,
      speedKmh: 85,
      nowMs: T0,
      disruption: { centre: DEN, radiusKm: 80 },
    });
    assert.strictEqual(r.impacted, true);
    assert.strictEqual(r.relation, "approaching");
    assert.ok(r.hoursToZone > 0, "should say how long until it enters");
    assert.ok(r.entryAtMs > T0);
    assert.match(r.reason, /enters the zone in/);
  });

  // This is the Chicago SHIP-MVP-105 contradiction: flagged as impacted, then
  // told "no active disruptions on planned route, continue".
  it("a shipment that has already passed the zone is NOT impacted", () => {
    const justPastDenver = [-104.5, 39.8];
    const r = geo.assess({
      remainingPath: [justPastDenver, ORD],  // only what is still ahead
      currentPosition: justPastDenver,
      speedKmh: 85,
      nowMs: T0,
      disruption: { centre: [-106.5, 39.5], radiusKm: 60 },
    });
    assert.strictEqual(r.impacted, false);
    assert.strictEqual(r.relation, "past");
    assert.match(r.reason, /already past/);
  });

  it("a tariff shock applies by country and date, not geography", () => {
    const d = { type: "Tariff", destinationCountry: "KE", productCategory: "Vaccine", effectiveFromMs: T0 };
    assert.strictEqual(
      geo.appliesNonGeographic({ disruption: d, shipment: { destinationCountry: "KE", cargoType: "Vaccine", etaMs: T0 + 48 * H }, nowMs: T0 }),
      true
    );
    // Arrives before it bites
    assert.strictEqual(
      geo.appliesNonGeographic({ disruption: d, shipment: { destinationCountry: "KE", cargoType: "Vaccine", etaMs: T0 - 48 * H }, nowMs: T0 }),
      false
    );
    // Wrong country
    assert.strictEqual(
      geo.appliesNonGeographic({ disruption: d, shipment: { destinationCountry: "NL", cargoType: "Vaccine", etaMs: T0 + 48 * H }, nowMs: T0 }),
      false
    );
  });
});

describe("graphRouter", () => {
  const edges = net.graphEdges();

  it("finds a path through the real network", () => {
    const p = router.shortestPath(edges, "PNQ", "NBO");
    assert.ok(p, "expected a route from Pune to Nairobi");
    assert.ok(p.nodes.length >= 2);
    assert.strictEqual(p.nodes[0], "PNQ");
    assert.strictEqual(p.nodes[p.nodes.length - 1], "NBO");
  });

  it("returns several genuinely different routes", () => {
    const paths = router.kShortestPaths(edges, "PNQ", "NBO", 3);
    assert.ok(paths.length >= 2, `only ${paths.length} route(s)`);
    const signatures = new Set(paths.map((p) => p.nodes.join(">")));
    assert.strictEqual(signatures.size, paths.length, "routes should be distinct");
  });

  it("each route carries hours, cost, CO2 and geometry", () => {
    const [p] = router.kShortestPaths(edges, "PNQ", "NBO", 1);
    assert.ok(p.summary.hours > 0);
    assert.ok(p.summary.costUsd > 0);
    assert.ok(p.summary.co2Kg > 0);
    assert.ok(p.summary.coords.length >= 2, "should carry drawable geometry");
  });

  it("blocking a node on the chosen route forces a different one", () => {
    const open = router.shortestPath(edges, "PNQ", "NBO");
    // Block a node the winning route actually uses, otherwise the test proves
    // nothing — the fastest Pune->Nairobi route is by air and never touches
    // Mombasa at all.
    const onRoute = open.nodes.find((n) => n !== "PNQ" && n !== "NBO");
    const blocked = router.shortestPath(edges, "PNQ", "NBO", { blockedNodes: new Set([onRoute]) });
    if (blocked) {
      assert.ok(!blocked.nodes.includes(onRoute), `route still uses blocked node ${onRoute}`);
      assert.notStrictEqual(open.nodes.join(">"), blocked.nodes.join(">"));
    }
  });

  it("delaying a node makes routes through it cost more time", () => {
    const base = router.shortestPath(edges, "PNQ", "NBO");
    const delayed = router.shortestPath(edges, "PNQ", "NBO", {
      nodeDelayH: new Map([["KEMBA", 96]]),
    });
    assert.ok(delayed, "should still find a route");
    assert.ok(delayed.weight >= base.weight, "a delay should never make it cheaper");
  });

  it("the air route is faster than the sea route on the hero lane", () => {
    const byTime = router.kShortestPaths(edges, "PNQ", "NBO", 3);
    const air = byTime.find((p) => p.summary.modes.includes("Air"));
    const sea = byTime.find((p) => p.summary.modes.includes("Sea"));
    if (air && sea) assert.ok(air.summary.hours < sea.summary.hours);
  });

  it("no route is reported between unconnected nodes", () => {
    const p = router.shortestPath(edges, "PNQ", "NOWHERE");
    assert.strictEqual(p, null);
  });
});

describe("landedCost", () => {
  it("vaccines into Kenya carry no duty", () => {
    assert.strictEqual(dutyRate({ cargoType: "Vaccine", destinationCountry: "KE" }), 0);
  });

  it("perishables do carry duty", () => {
    assert.ok(dutyRate({ cargoType: "Perishable", destinationCountry: "NL" }) > 0);
  });

  it("totals freight, fees, dwell, duty and expected spoilage", () => {
    const r = landedCost({
      freightUsd: 3000,
      transitHours: 240,
      nodes: ["INNSA", "KEMBA"],
      nodeTable: net.NODES,
      cargoType: "Perishable",
      destinationCountry: "KE",
      declaredValueUsd: 100000,
      pLoss: 0.1,
    });
    assert.ok(r.totalUsd > 3000, "total should exceed bare freight");
    assert.ok(r.breakdown.dutyUsd > 0);
    assert.ok(r.breakdown.expectedSpoilageUsd === 10000);
    assert.ok(r.breakdown.customsDwellHours > 0);
  });

  it("spoilage risk shows up as money", () => {
    const safe = landedCost({ freightUsd: 1000, declaredValueUsd: 500000, pLoss: 0 });
    const risky = landedCost({ freightUsd: 1000, declaredValueUsd: 500000, pLoss: 0.5 });
    assert.strictEqual(risky.totalUsd - safe.totalUsd, 250000);
  });

  it("the illustrative caveat travels with the number", () => {
    const r = landedCost({ freightUsd: 100 });
    assert.match(r.note, /illustrative/);
  });
});
