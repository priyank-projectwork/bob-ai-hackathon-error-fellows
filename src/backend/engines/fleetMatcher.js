/**
 * Fleet Matcher
 * Calculates matching scores for idle fleets.
 */

// Helper function to calculate distance in km using Haversine formula
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const FLEET_WEIGHTS = {
  a1: 0.40, // location_proximity
  a2: 0.20, // capacity_fit
  a3: 0.10, // availability_fit
  a4: 0.20, // capability_fit
  a5: 0.10, // destination_fit
  a6: 0.10  // deadhead_distance (penalty)
};

/**
 * Ranks a list of idle fleets for a specific shipment.
 */
function rankFleetMatches(shipment, idleFleets) {
  const matches = [];

  for (const fleet of idleFleets) {
    // Hard filter: If shipment requires cold chain, fleet must be capable.
    if (shipment.cargoType === "Vaccine" || shipment.cargoType === "Perishable") {
      if (!fleet.coldChainCapable) continue; // Skip incompatible fleets
    }

    // 1. Proximity Score (0-100)
    let proximityScore = 0;
    let distanceKm = 0;
    if (shipment.currentLocation && fleet.currentLocation) {
      distanceKm = getDistance(
        shipment.currentLocation.lat, shipment.currentLocation.lng,
        fleet.currentLocation.lat, fleet.currentLocation.lng
      );
      // Closer is better. Say 100km is score 0, 0km is score 100.
      proximityScore = Math.max(0, 100 - (distanceKm)); 
    }

    // 2. Capability Fit
    const capabilityFit = fleet.coldChainCapable ? 100 : 50;

    // 3. Capacity Fit
    // Assume cargo is standard weight for demo. If fleet > cargo, score 100.
    const capacityFit = fleet.capacityWeight >= 5000 ? 100 : 0;
    if (capacityFit === 0) continue; // Hard filter on capacity

    // 4. Deadhead Penalty
    // Same as distance for this simple model
    const deadheadPenalty = distanceKm; 

    // Final Match Score
    const matchScore = 
      (FLEET_WEIGHTS.a1 * proximityScore) +
      (FLEET_WEIGHTS.a2 * capacityFit) +
      (FLEET_WEIGHTS.a4 * capabilityFit) -
      (FLEET_WEIGHTS.a6 * deadheadPenalty);

    matches.push({
      fleet,
      matchScore: Math.round(matchScore),
      distanceKm: Math.round(distanceKm)
    });
  }

  // Sort by highest match score
  return matches.sort((a, b) => b.matchScore - a.matchScore);
}

module.exports = {
  rankFleetMatches
};
