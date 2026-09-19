/**
 * landedCost.js — what a route actually costs to get through the door.
 *
 * Freight alone is the wrong comparison. A route that looks cheap can lose on
 * duty; a route that looks fast can lose because a border holds the cargo long
 * enough to eat its stability budget. Landed cost puts those in one number:
 *
 *   freight + port/canal fees + customs dwell cost + duty + expected spoilage
 *
 * Duty rates and dwell benchmarks are ILLUSTRATIVE. They are shaped like the
 * real thing and sourced where we could, but no number here should be quoted
 * as fact — see docs/regulatory-basis.md.
 *
 * PURE: no database, no network, no clock.
 */
"use strict";

const duties = require("../data/duty-rules.json");

/** Duty rate for a cargo type entering a country, as a fraction. */
function dutyRate({ cargoType, destinationCountry }) {
  const rows = duties.rules ?? [];
  const match =
    rows.find((r) => r.country === destinationCountry && r.cargoType === cargoType) ??
    rows.find((r) => r.country === "*" && r.cargoType === cargoType) ??
    rows.find((r) => r.country === destinationCountry && r.cargoType === "*");
  return match ? match.ratePct / 100 : 0;
}

/** Hours cargo typically sits at customs for this country. */
function customsDwellHours({ destinationCountry }) {
  const row = (duties.dwell ?? []).find((d) => d.country === destinationCountry);
  return row ? row.hours : 0;
}

/**
 * @param {object} args
 * @param {number} args.freightUsd
 * @param {number} args.transitHours
 * @param {string[]} args.nodes           node ids on the path
 * @param {object} args.nodeTable         id -> node
 * @param {string} args.cargoType
 * @param {string} args.destinationCountry
 * @param {number} args.declaredValueUsd
 * @param {number} [args.pLoss]           probability of spoilage, from the clock
 */
function landedCost({
  freightUsd = 0,
  transitHours = 0,
  nodes = [],
  nodeTable = {},
  cargoType = "Standard",
  destinationCountry = null,
  declaredValueUsd = 0,
  pLoss = 0,
  holdingCostPerHourUsd = 12, // [illustrative]
}) {
  let feesUsd = 0;
  for (const id of nodes) {
    const n = nodeTable[id];
    if (!n) continue;
    const fee = n.feeUsd ?? 0;
    feesUsd += n.feeBasis === "vessel" && n.amortiseOverTeu ? fee / n.amortiseOverTeu : fee;
  }

  const dwellH = customsDwellHours({ destinationCountry });
  const dwellCostUsd = dwellH * holdingCostPerHourUsd;

  const rate = dutyRate({ cargoType, destinationCountry });
  const dutyUsd = declaredValueUsd * rate;

  const expectedSpoilageUsd = declaredValueUsd * pLoss;

  const totalUsd = Math.round(freightUsd + feesUsd + dwellCostUsd + dutyUsd + expectedSpoilageUsd);

  return {
    totalUsd,
    breakdown: {
      freightUsd: Math.round(freightUsd),
      feesUsd: Math.round(feesUsd),
      customsDwellHours: dwellH,
      dwellCostUsd: Math.round(dwellCostUsd),
      dutyRatePct: Number((rate * 100).toFixed(2)),
      dutyUsd: Math.round(dutyUsd),
      expectedSpoilageUsd: Math.round(expectedSpoilageUsd),
      transitHours: Number(transitHours.toFixed(1)),
    },
    note: "Duty rates and dwell benchmarks are illustrative — see docs/regulatory-basis.md",
  };
}

module.exports = { landedCost, dutyRate, customsDwellHours };
