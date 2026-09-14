/**
 * Route Optimizer
 * Candidate generation and constraint evaluation.
 */

// Simple mock graph for the hackathon
const DEMO_GRAPH = {
  "New York": [
    { destination: "Chicago", cost: 1000, timeHours: 12, risk: 10 },
    { destination: "Atlanta", cost: 800, timeHours: 14, risk: 5 }
  ],
  "Chicago": [
    { destination: "Los Angeles", cost: 2000, timeHours: 30, risk: 15 },
    { destination: "Denver", cost: 1000, timeHours: 15, risk: 5 }
  ],
  "Atlanta": [
    { destination: "Los Angeles", cost: 2200, timeHours: 32, risk: 10 },
    { destination: "Houston", cost: 800, timeHours: 12, risk: 5 }
  ],
  "Houston": [
    { destination: "Los Angeles", cost: 1500, timeHours: 24, risk: 10 }
  ],
  "Denver": [
    { destination: "Los Angeles", cost: 1000, timeHours: 15, risk: 20 } // Denver to LA might cross disruption
  ]
};

// If a disruption occurs in LA, direct routes might have an added penalty.
function getRouteAlternatives(origin, destination, activeDisruptions) {
  // For the demo, we'll hardcode 2 alternatives that avoid the disruption if it's in LA.
  // In a real app, use Dijkstra or A* to traverse DEMO_GRAPH considering disruption penalties.
  
  const alternatives = [];
  
  if (destination === "Los Angeles" && activeDisruptions.some(d => d.geometry && d.geometry.locationName === "Los Angeles")) {
    alternatives.push({
      route: "New York -> Atlanta -> Houston -> San Diego (Land Bridge to LA)",
      costDelta: 1500, // additional cost
      timeDeltaHours: 24, // 1 day delay
      riskScore: 30, // lower risk since it avoids the port strike
      rationale: "Avoids direct LA port congestion by rerouting via San Diego."
    });
    
    alternatives.push({
      route: "New York -> Chicago -> Denver -> Las Vegas (Air Freight to LA)",
      costDelta: 5000,
      timeDeltaHours: -12, // faster
      riskScore: 20,
      rationale: "Significantly faster but at a much higher cost. Avoids port entirely."
    });
  } else {
    // Default alternatives if no matching disruption
    alternatives.push({
      route: "New York -> Chicago -> Los Angeles",
      costDelta: 0,
      timeDeltaHours: 0,
      riskScore: 10,
      rationale: "Standard route."
    });
  }
  
  return alternatives.sort((a, b) => a.riskScore - b.riskScore); // Ranked by lowest risk
}

module.exports = {
  getRouteAlternatives
};
