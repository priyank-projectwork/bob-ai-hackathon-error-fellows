/**
 * optionGenerator.js — what can we actually do about it?
 *
 * Produces the full option set a dispatcher should see, not just reroutes:
 *
 *   do_nothing        — carry on, priced honestly
 *   wait_it_out       — the disruption has an expected end; sit it out
 *   reroute           — a different path through the graph
 *   hold_at_depot     — park at cold storage; the stability clock stops
 *   switch_carrier    — same route, different carrier
 *
 * Every option is then tested against the shipment's life clock. An option
 * whose ETA outlasts the cargo is returned as INFEASIBLE with the shortfall,
 * not filtered out — the dispatcher needs to see that the cheap option was
 * considered and rejected, and why.
 *
 * PURE: no database, no network, no clock.
 */
"use strict";

const { kShortestPaths } = require("./graphRouter");
const { landedCost } = require("./landedCost");

/**
 * @param {object} args
 * @param {object} args.shipment     { shipmentId, originNode, destNode, etaMs, cargoType, destinationCountry, tonnes }
 * @param {object} args.clock        output of viabilityClock.computeClock
 * @param {object} args.profile      rule profile
 * @param {Array}  args.edges        network graph edges
 * @param {Array}  args.disruptions  active disruptions (already assessed)
 * @param {Array}  args.carriers     carrier catalogue
 * @param {number} args.nowMs
 * @param {object} args.feasibility  viabilityClock.feasibility
 * @param {object} args.financials   viabilityClock.financials
 */
function generate({ shipment, clock, profile, edges, disruptions, carriers, nowMs, feasibility, financials, nodes }) {
  const options = [];
  const blockedNodes = new Set();
  const nodeDelayH = new Map();

  for (const d of disruptions) {
    if (d.blocksNodes) for (const n of d.blocksNodes) blockedNodes.add(n);
    if (d.delaysNodes) for (const [n, h] of Object.entries(d.delaysNodes)) nodeDelayH.set(n, h);
  }

  const delayFromDisruption = [...nodeDelayH.values()].reduce((a, b) => a + b, 0);

  // ── 1. Do nothing ────────────────────────────────────────────────────────
  const doNothingEtaMs = nowMs + ((shipment.remainingHours ?? 0) + delayFromDisruption) * 3.6e6;
  options.push(makeOption({
    kind: "do_nothing",
    label: "Continue as planned",
    etaMs: doNothingEtaMs,
    costUsd: 0,
    co2Kg: 0,
    deltaHours: delayFromDisruption,
    rationale: delayFromDisruption > 0
      ? `Absorbs the full ${delayFromDisruption.toFixed(0)} h delay.`
      : "No change.",
    actions: [],
  }, { shipment, clock, profile, feasibility, financials, nowMs }));

  // ── 2. Wait it out ───────────────────────────────────────────────────────
  const endingSoon = disruptions.filter((d) => Number.isFinite(d.expectedEndMs));
  if (endingSoon.length) {
    const clearsAtMs = Math.max(...endingSoon.map((d) => d.expectedEndMs));
    const waitH = Math.max(0, (clearsAtMs - nowMs) / 3.6e6);
    options.push(makeOption({
      kind: "wait_it_out",
      label: "Hold position until the disruption clears",
      etaMs: nowMs + (waitH + (shipment.remainingHours ?? 0)) * 3.6e6,
      costUsd: Math.round(waitH * (shipment.demurrageUsdPerHour ?? 45)),
      co2Kg: 0,
      deltaHours: waitH,
      rationale: `Expected to clear in ${waitH.toFixed(0)} h; no rerouting cost.`,
      actions: [{ type: "hold", untilMs: clearsAtMs }],
    }, { shipment, clock, profile, feasibility, financials, nowMs }));
  }

  // ── 3. Reroutes ──────────────────────────────────────────────────────────
  if (shipment.originNode && shipment.destNode) {
    const paths = kShortestPaths(edges, shipment.originNode, shipment.destNode, 3, {
      blockedNodes,
      nodeDelayH,
    });
    for (const [i, p] of paths.entries()) {
      const cost = landedCost({
        freightUsd: p.summary.costUsd,
        transitHours: p.summary.hours,
        nodes: p.nodes,
        nodeTable: nodes,
        cargoType: shipment.cargoType,
        destinationCountry: shipment.destinationCountry,
        declaredValueUsd: shipment.declaredValueUsd ?? 0,
      });
      options.push(makeOption({
        kind: i === 0 ? "reroute_primary" : "reroute_alternate",
        label: `Route via ${p.nodes.slice(1, -1).join(" → ") || "direct"}`,
        etaMs: nowMs + p.summary.hours * 3.6e6,
        costUsd: cost.totalUsd,
        co2Kg: p.summary.co2Kg,
        deltaHours: p.summary.hours - (shipment.remainingHours ?? p.summary.hours),
        rationale:
          `${p.summary.distanceKm} km, ${p.summary.hours.toFixed(0)} h, ` +
          `${p.summary.modes.join("+")}${p.summary.multiModal ? " (multi-modal)" : ""}.`,
        costBreakdown: cost.breakdown,
        nodes: p.nodes,
        coords: p.summary.coords,
        modes: p.summary.modes,
        actions: [{ type: "reroute", nodes: p.nodes }],
      }, { shipment, clock, profile, feasibility, financials, nowMs }));
    }
  }

  // ── 4. Hold at cold storage — the clock stops ────────────────────────────
  const depot = (shipment.nearbyDepots ?? []).find((d) => d.coldStorage);
  if (depot) {
    options.push(makeOption({
      kind: "hold_at_depot",
      label: `Hold at ${depot.name} (cold storage)`,
      etaMs: nowMs + ((depot.reachHours ?? 2) + (shipment.remainingHours ?? 0) + delayFromDisruption) * 3.6e6,
      costUsd: depot.feeUsd ?? 600,
      co2Kg: 0,
      deltaHours: (depot.reachHours ?? 2) + delayFromDisruption,
      rationale:
        `Cargo on depot power: the stability clock stops draining while it waits. ` +
        `${depot.gdpCertified ? "GDP-certified site." : "Not GDP-certified — note on the deviation record."}`,
      stopsStabilityClock: true,
      actions: [{ type: "hold_at_depot", nodeId: depot.id }],
    }, { shipment, clock, profile, feasibility, financials, nowMs }));
  }

  // ── 5. Carrier switch ────────────────────────────────────────────────────
  const current = carriers.find((c) => c.code === shipment.carrier);
  const better = carriers
    .filter((c) => c.code !== shipment.carrier && c.onTimePct > (current?.onTimePct ?? 0))
    .sort((a, b) => b.onTimePct - a.onTimePct)[0];
  if (better) {
    const saveH = (shipment.remainingHours ?? 0) * 0.08; // [illustrative]
    options.push(makeOption({
      kind: "switch_carrier",
      label: `Switch to ${better.name}`,
      etaMs: nowMs + Math.max(0, (shipment.remainingHours ?? 0) - saveH) * 3.6e6,
      costUsd: Math.round((shipment.remainingKm ?? 0) * (better.ratePerKm - (current?.ratePerKm ?? better.ratePerKm))),
      co2Kg: 0,
      deltaHours: -saveH,
      rationale:
        `${better.onTimePct}% on time vs ${current?.onTimePct ?? "—"}%. ` +
        `${better.gdpCertified ? "GDP certified" : "not GDP certified"}` +
        `${better.ceivPharma ? ", IATA CEIV Pharma" : ""}.`,
      actions: [{ type: "switch_carrier", carrier: better.code }],
    }, { shipment, clock, profile, feasibility, financials, nowMs }));
  }

  // Feasible first, then by how much cargo life each one leaves.
  options.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return b.lifeClockAtDeliveryH - a.lifeClockAtDeliveryH;
  });

  return options;
}

/** Attach the clock verdict and the money to a candidate option. */
function makeOption(raw, { shipment, clock, profile, feasibility, financials, nowMs }) {
  const verdict = feasibility({
    needByAtMs: shipment.needByAtMs,
    option: {
      etaMs: raw.etaMs,
      expectedOutOfRangeH: raw.stopsStabilityClock ? {} : (raw.expectedOutOfRangeH ?? {}),
    },
    clock,
    profile,
  });

  const money = financials({
    lifeClockAtDeliveryH: verdict.lifeClockAtDeliveryH,
    declaredValueUsd: shipment.declaredValueUsd ?? 0,
    doses: shipment.doses ?? 0,
  });

  return {
    ...raw,
    etaIso: new Date(raw.etaMs).toISOString(),
    ...verdict,
    ...money,
    // What the dispatcher reads when an option is struck out.
    infeasibleBecause: verdict.feasible
      ? null
      : verdict.reason === "schedule"
        ? `arrives ${Math.abs(verdict.scheduleAtDeliveryH).toFixed(0)} h after the deadline`
        : `cargo has ${clock.stabilityMarginH.toFixed(0)} h of stability left; this route needs more`,
  };
}

module.exports = { generate, makeOption };
