/**
 * Impact Engine
 * Calculates the spatial intersection between active disruptions and shipment route legs.
 */

// Helper function to calculate distance in km using Haversine formula
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Checks if a shipment is exposed to a disruption based on its current location
 * and its planned route legs.
 */
function calculateDisruptionImpact(shipment, routeLegs, disruption) {
  let isImpacted = false;
  let maxExposureScore = 0;
  let impactedLegs = [];

  const { lat: dLat, lng: dLng, radius: dRadius } = disruption.geometry;

  // Check current location
  if (shipment.currentLocation) {
    const distToCurrent = getDistance(dLat, dLng, shipment.currentLocation.lat, shipment.currentLocation.lng);
    if (distToCurrent <= dRadius) {
      isImpacted = true;
      maxExposureScore = 100; // Currently inside the disruption zone
    }
  }

  // Check planned route legs
  for (const leg of routeLegs) {
    // Check start and end locations of the leg
    const distToStart = getDistance(dLat, dLng, leg.startLocation.lat, leg.startLocation.lng);
    const distToEnd = getDistance(dLat, dLng, leg.endLocation.lat, leg.endLocation.lng);
    
    // If either start or end is within disruption radius, or passes through
    if (distToStart <= dRadius || distToEnd <= dRadius) {
      isImpacted = true;
      impactedLegs.push(leg);
      
      // Calculate exposure score based on proximity
      const minDistance = Math.min(distToStart, distToEnd);
      const exposureScore = Math.max(0, 100 - (minDistance / dRadius) * 100);
      if (exposureScore > maxExposureScore) {
        maxExposureScore = exposureScore;
      }
    }
  }

  return {
    isImpacted,
    exposureScore: maxExposureScore,
    impactedLegs
  };
}

module.exports = {
  calculateDisruptionImpact
};
