/**
 * Cold Chain Engine
 * Excursion detection, grouping, and severity classification.
 */

/**
 * Evaluates a new sensor reading against a rule profile and ongoing excursion history.
 */
function evaluateTelemetry(reading, ruleProfile, openExcursion = null) {
  const temp = reading.temperatureCelsius;
  
  // 1. Is it safe?
  if (temp >= ruleProfile.minTempC && temp <= ruleProfile.maxTempC) {
    if (openExcursion) {
      // Returned to safe range -> resolve excursion
      return { action: "RESOLVE_EXCURSION", severity: "None" };
    }
    return { action: "SAFE", severity: "None" };
  }

  // 2. Is it in the warning band?
  const isBelowWarning = temp < ruleProfile.minTempC && temp >= (ruleProfile.minTempC - ruleProfile.warningBand);
  const isAboveWarning = temp > ruleProfile.maxTempC && temp <= (ruleProfile.maxTempC + ruleProfile.warningBand);
  
  if (isBelowWarning || isAboveWarning) {
    if (!openExcursion) {
      return { action: "WARNING", severity: "Warning" };
    }
    // If there is an open excursion, it remains open but severity might just be warning level.
  }

  // 3. Excursion! Outside warning band or time threshold breached.
  // For the hackathon demo, we will use a simplified duration check.
  if (!openExcursion) {
    // Open a new excursion incident
    return { action: "OPEN_EXCURSION", severity: "Minor" }; // Starts minor
  } else {
    // Update existing excursion severity based on duration
    const durationMs = new Date(reading.timestamp).getTime() - new Date(openExcursion.startedAt).getTime();
    const durationMinutes = durationMs / (1000 * 60);

    // Find the highest severity threshold breached
    let newSeverity = openExcursion.severity;
    // Sort thresholds descending by maxMinutes to find the highest applicable
    const thresholds = [...ruleProfile.durationRules.thresholds].sort((a, b) => b.maxMinutes - a.maxMinutes);
    
    for (const threshold of thresholds) {
      if (durationMinutes >= threshold.maxMinutes) {
        newSeverity = threshold.severity;
        break; // found the highest severity threshold breached
      }
    }

    return { 
      action: "UPDATE_EXCURSION", 
      severity: newSeverity,
      durationMinutes 
    };
  }
}

module.exports = {
  evaluateTelemetry
};
