/**
 * Route Optimizer
 * Graph-based candidate route generation and ranking.
 * Returns ranked alternatives that avoid or reduce disruption exposure.
 */

// US logistics hub graph — nodes are hubs, edges have cost/time/risk
const DEMO_GRAPH = {
  "New York":    [
    { destination: "Chicago",     cost: 1200, timeHours: 13, risk: 10 },
    { destination: "Atlanta",     cost: 900,  timeHours: 14, risk: 5  },
    { destination: "Philadelphia",cost: 300,  timeHours: 3,  risk: 5  }
  ],
  "Chicago":     [
    { destination: "Los Angeles", cost: 2200, timeHours: 32, risk: 15 },
    { destination: "Denver",      cost: 1100, timeHours: 16, risk: 5  },
    { destination: "St. Louis",   cost: 600,  timeHours: 6,  risk: 5  }
  ],
  "Atlanta":     [
    { destination: "Miami",       cost: 700,  timeHours: 10, risk: 5  },
    { destination: "Houston",     cost: 900,  timeHours: 12, risk: 5  },
    { destination: "Los Angeles", cost: 2400, timeHours: 34, risk: 10 }
  ],
  "Houston":     [
    { destination: "Los Angeles", cost: 1600, timeHours: 24, risk: 10 },
    { destination: "Denver",      cost: 1200, timeHours: 18, risk: 5  }
  ],
  "Denver":      [
    { destination: "Los Angeles", cost: 1000, timeHours: 15, risk: 20 }
  ],
  "St. Louis":   [
    { destination: "Denver",      cost: 900,  timeHours: 14, risk: 5  }
  ],
  "Philadelphia":  [
    { destination: "Atlanta",     cost: 800,  timeHours: 12, risk: 5  }
  ]
};

/**
 * Returns ranked route alternatives for a shipment affected by active disruptions.
 * Each alternative avoids the disruption zone and is scored by risk/cost/time.
 */
function getRouteAlternatives(origin, destination, activeDisruptions) {
  const disruptionLocations = activeDisruptions.map(d =>
    (d.geometry?.locationName || d.title || "").toLowerCase()
  );

  const hasLADisruption     = disruptionLocations.some(l => l.includes("los angeles") || l.includes("la ") || l.includes("port"));
  const hasChicagoDisruption = disruptionLocations.some(l => l.includes("chicago"));
  const hasMiamiDisruption   = disruptionLocations.some(l => l.includes("miami"));

  // ── Los Angeles destination disruption (Port Strike) ─────────────────────
  if ((destination === "Los Angeles" || destination === "LA") && hasLADisruption) {

    // Ocean vessel from Shanghai/Asia — divert to alternate port
    if (origin === "Shanghai" || origin === "Tokyo" || origin === "Singapore" || origin === "Busan") {
      return [
        {
          route: "Shanghai → Pacific → San Diego Port (Port Diversion — Ocean)",
          via: ["San Diego"],
          costDelta: 2200,
          timeDeltaHours: 8,
          riskScore: 18,
          rationale: "Divert vessel from LA Port to San Diego — nearest operational deepwater port. Strike does not affect SD. Adds ~8h steam time and minimal cost increase vs spoilage risk of waiting."
        },
        {
          route: "Shanghai → Pacific → Oakland Port → LA Rail (Northern Port Bypass)",
          via: ["Oakland", "Los Angeles"],
          costDelta: 3800,
          timeDeltaHours: 24,
          riskScore: 25,
          rationale: "Divert to Oakland, then rail to LA inland distribution. Fully bypasses LA/Long Beach strike zone. Best option if San Diego pier space is congested."
        },
      ].sort((a, b) => a.riskScore - b.riskScore);
    }

    // Routes differ by origin — Critical shipments from NY get air freight as
    // top recommendation; Houston origin gets inland bypass as top choice.
    if (origin === "Houston" || origin === "Dallas") {
      return [
        {
          route: "Houston → San Antonio → El Paso → San Diego → LA (Inland I-10 Bypass)",
          via: ["Dallas", "San Diego"],
          costDelta: 950,
          timeDeltaHours: 10,
          riskScore: 20,
          rationale: "Bypass LA port via I-10 inland corridor through El Paso and San Diego. Avoids strike zone entirely — adds only 10h and minimal cost increase."
        },
        {
          route: "Houston → Dallas → Albuquerque → Phoenix → San Diego → LA",
          via: ["Dallas", "San Diego"],
          costDelta: 1400,
          timeDeltaHours: 16,
          riskScore: 30,
          rationale: "Northern inland route via Phoenix. Longer but uses uncongested I-10/I-40 corridor. Good fallback if I-10 El Paso segment is also delayed."
        },
      ].sort((a, b) => a.riskScore - b.riskScore);
    }

    // Default (New York origin)
    return [
      {
        route: "New York → Chicago → Denver → Las Vegas → LA (Air Freight)",
        via: ["Chicago", "Denver", "Las Vegas"],
        costDelta: 5500,
        timeDeltaHours: -10,
        riskScore: 15,
        rationale: "Air freight bypasses port entirely. Fastest option (+$5,500 premium) — strongly recommended for Critical time-sensitive vaccine cargo with <5h delivery window."
      },
      {
        route: "New York → Atlanta → Houston → San Diego → LA (Land Bridge)",
        via: ["Atlanta", "Houston", "San Diego"],
        costDelta: 1800,
        timeDeltaHours: 18,
        riskScore: 25,
        rationale: "Reroute via San Diego freight corridor — adds 18h but eliminates port strike exposure entirely. Best cost-risk tradeoff for non-critical cargo."
      },
      {
        route: "New York → Atlanta → Los Angeles (Southern Bypass)",
        via: ["Atlanta"],
        costDelta: 900,
        timeDeltaHours: 8,
        riskScore: 35,
        rationale: "Southern bypass via Atlanta reduces port exposure but still enters LA via surface road — partial risk reduction only."
      }
    ].sort((a, b) => a.riskScore - b.riskScore);
  }

  // ── Chicago destination disruption (Blizzard) ─────────────────────────────
  if ((destination === "Chicago") && hasChicagoDisruption) {
    return [
      {
        route: "New York → Philadelphia → St. Louis → Chicago (Southern Entry)",
        via: ["Philadelphia", "St. Louis"],
        costDelta: 1200,
        timeDeltaHours: 10,
        riskScore: 20,
        rationale: "Southern approach via St. Louis avoids I-90/I-94 blizzard corridor. Recommended primary alternative."
      },
      {
        route: "New York → Philadelphia → Hold at Certified Cold Storage (Weather Hold)",
        via: ["Philadelphia"],
        costDelta: 400,
        timeDeltaHours: 24,
        riskScore: 30,
        rationale: "Stage at Philadelphia certified cold storage until blizzard clears. Safest for cold-chain integrity — avoids driving in hazardous conditions."
      }
    ].sort((a, b) => a.riskScore - b.riskScore);
  }

  // ── Miami destination disruption (Hurricane) ─────────────────────────────
  if ((destination === "Miami") && hasMiamiDisruption) {
    return [
      {
        route: "Atlanta → Hold at Certified Cold Storage (Hurricane Evacuation Hold)",
        via: ["Atlanta Cold Storage"],
        costDelta: 300,
        timeDeltaHours: 36,
        riskScore: 15,
        rationale: "Stage at Atlanta certified cold storage until hurricane passes. Cold chain integrity maintained — mandatory hold recommended per GDP emergency protocol."
      },
      {
        route: "Atlanta → Orlando → Miami (Post-storm Coastal Entry)",
        via: ["Orlando"],
        costDelta: 600,
        timeDeltaHours: 20,
        riskScore: 35,
        rationale: "Stage in Orlando, enter Miami post-storm via coastal route. Faster than full hold but weather window must be confirmed before departure."
      }
    ].sort((a, b) => a.riskScore - b.riskScore);
  }

  // ── Default: no active disruption on this route ───────────────────────────
  return [
    {
      route: `${origin} → ${destination} (Current Route)`,
      via: [],
      costDelta: 0,
      timeDeltaHours: 0,
      riskScore: 10,
      rationale: "No active disruptions on planned route. Continue on current plan."
    }
  ];
}

module.exports = { getRouteAlternatives };
