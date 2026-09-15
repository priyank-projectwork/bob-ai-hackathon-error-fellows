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

    // ── Ocean vessel (Shanghai/Asia) → divert to alternate port, then road to LA ──
    // MULTI-MODAL: Sea leg diverts to SD port, then road reefer truck to LA distribution
    if (origin === "Shanghai" || origin === "Tokyo" || origin === "Singapore" || origin === "Busan") {
      return [
        {
          route: "Shanghai → Pacific → San Diego Port [Sea] → LA Distribution Hub [Road]",
          via: ["San Diego", "Los Angeles"],
          modes: ["Sea", "Road"],
          costDelta: 2200,
          timeDeltaHours: 10,
          riskScore: 18,
          rationale: "MULTI-MODAL: Divert vessel to San Diego (nearest strike-free deepwater port, +8h steam). Offload to cold-chain reefer truck at SD pier for final 120km road leg to LA distribution hub (+2h). Strike does not affect San Diego terminal."
        },
        {
          route: "Shanghai → Pacific → Oakland Port [Sea] → LA via I-5 [Road]",
          via: ["Oakland", "Los Angeles"],
          modes: ["Sea", "Road"],
          costDelta: 3800,
          timeDeltaHours: 28,
          riskScore: 25,
          rationale: "MULTI-MODAL: Divert to Oakland (+20h steam north), offload to reefer truck for I-5 south road leg to LA (~8h drive). Fully bypasses LA/Long Beach strike zone. Best if San Diego pier space is congested."
        },
      ].sort((a, b) => a.riskScore - b.riskScore);
    }

    // ── Houston → LA: Road truck — LA Port Strike blocks the LA receiving gate ──
    // NOTE: Port strikes close ALL receiving gates including road-freight docks.
    // The truck physically cannot deliver to the LA warehouse adjacent to the port.
    // Reroute avoids the LA port gate by delivering to an inland distribution hub.
    if (origin === "Houston" || origin === "Dallas") {
      return [
        {
          route: "Houston → San Antonio → El Paso → San Diego → LA (Inland I-10 Bypass)",
          via: ["San Antonio", "El Paso", "San Diego", "Los Angeles"],
          costDelta: 950,
          timeDeltaHours: 10,
          riskScore: 20,
          rationale: "Port Strike closes LA port road-freight gate. Reroute via I-10 inland: San Antonio → El Paso → San Diego. Deliver to SD cross-dock, then short road leg to LA inland hub — bypasses the port gate entirely. +10h, +$950."
        },
        {
          route: "Houston → Dallas → Albuquerque → Phoenix → San Diego → LA (I-10/I-40 Bypass)",
          via: ["Dallas", "Albuquerque", "Phoenix", "San Diego", "Los Angeles"],
          costDelta: 1400,
          timeDeltaHours: 16,
          riskScore: 30,
          rationale: "Northern inland route via I-40 through Albuquerque and Phoenix. Longer but avoids any congestion on I-10 El Paso corridor. Fallback if I-10 El Paso segment is also delayed."
        },
      ].sort((a, b) => a.riskScore - b.riskScore);
    }

    // ── New York → LA: Air freight recommended (Critical priority, tight deadline) ──
    // MULTI-MODAL: Road to airport, then air freight to LA, road reefer to cold-storage
    return [
      {
        route: "New York → JFK Airport [Road] → LAX Airport [Air] → LA Cold Hub [Road]",
        via: ["JFK Airport", "LAX Airport", "Los Angeles"],
        modes: ["Road", "Air", "Road"],
        costDelta: 5500,
        timeDeltaHours: -10,
        riskScore: 15,
        rationale: "MULTI-MODAL: Road to JFK (2h), air freight NYK→LAX bypassing port entirely (6h flight, -10h vs road), cold-chain reefer from LAX to LA distribution hub (1h). Fastest option — recommended for Critical mRNA cargo with tight cold-chain window."
      },
      {
        route: "New York → Atlanta → Houston → San Diego → LA (Land Bridge Road)",
        via: ["Atlanta", "Houston", "San Diego", "Los Angeles"],
        modes: ["Road"],
        costDelta: 1800,
        timeDeltaHours: 18,
        riskScore: 25,
        rationale: "All-road southern bypass: NY → Atlanta → Houston → San Diego, then short road leg to LA inland hub. +18h but eliminates port exposure entirely. Best cost-risk for High priority cargo."
      },
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
