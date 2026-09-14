/**
 * Risk Engine
 * Deterministic risk scoring and explanation factors.
 */

// Weights for scoring (configurable)
const WEIGHTS = {
  w1: 0.30, // disruption_exposure
  w2: 0.20, // delay_to_deadline
  w3: 0.20, // cargo_criticality
  w4: 0.10, // route_dependency
  w5: 0.10, // cold_chain_risk
  w6: 0.10  // financial_exposure
};

/**
 * Calculates a deterministic Risk Score (0-100) for a shipment.
 */
function calculateShipmentRisk(shipment, exposureScore = 0, delayHours = 0, coldChainRisk = 0) {
  let riskDrivers = [];

  // 1. Disruption Exposure (0-100)
  const disruptionRisk = exposureScore;
  if (disruptionRisk > 50) riskDrivers.push("High disruption exposure");

  // 2. Delay to Deadline (0-100)
  // E.g., if delay takes up >50% of the buffer time, risk goes up
  let delayRisk = 0;
  if (shipment.eta && shipment.deliveryDeadline) {
    const bufferHours = (shipment.deliveryDeadline - shipment.eta) / (1000 * 60 * 60);
    if (delayHours > 0) {
      delayRisk = Math.min(100, (delayHours / Math.max(1, bufferHours)) * 100);
      if (delayRisk > 50) riskDrivers.push("High risk of missing delivery deadline");
    }
  }

  // 3. Cargo Criticality (0-100)
  let criticalityRisk = 0;
  if (shipment.priority === "Critical") criticalityRisk = 100;
  else if (shipment.priority === "High") criticalityRisk = 75;
  else if (shipment.priority === "Medium") criticalityRisk = 50;
  else if (shipment.priority === "Low") criticalityRisk = 25;
  if (criticalityRisk >= 75) riskDrivers.push(`${shipment.priority} priority cargo`);

  // 4. Route Dependency (0-100)
  // Simplified for demo: fewer alternate routes = higher risk
  const routeDependencyRisk = 50; 

  // 5. Cold Chain Risk (0-100)
  if (coldChainRisk > 50) riskDrivers.push("Active temperature excursion");

  // 6. Financial Exposure (0-100)
  const maxDemoValue = 1000000;
  const financialRisk = Math.min(100, ((shipment.cargoValue || 0) / maxDemoValue) * 100);
  if (financialRisk > 50) riskDrivers.push("High value cargo");

  // Calculate final score
  const finalScore = 
    (WEIGHTS.w1 * disruptionRisk) +
    (WEIGHTS.w2 * delayRisk) +
    (WEIGHTS.w3 * criticalityRisk) +
    (WEIGHTS.w4 * routeDependencyRisk) +
    (WEIGHTS.w5 * coldChainRisk) +
    (WEIGHTS.w6 * financialRisk);

  return {
    score: Math.round(finalScore),
    riskDrivers
  };
}

/**
 * Classifies risk score into bands.
 */
function getRiskBand(score) {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "WATCH";
  return "NORMAL";
}

module.exports = {
  calculateShipmentRisk,
  getRiskBand
};
