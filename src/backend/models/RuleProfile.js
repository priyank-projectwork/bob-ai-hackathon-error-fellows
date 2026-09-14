const mongoose = require("mongoose");

const ruleProfileSchema = new mongoose.Schema({
  name: { type: String },
  version: { type: String },
  productType: { type: String, enum: ["Vaccine", "Perishable", "Standard"] },
  minTempC: { type: Number },
  maxTempC: { type: Number },
  warningBand: { type: Number },
  durationRules: {
    // Array of duration thresholds, e.g. { maxMinutes: 30, severity: "High" }
    thresholds: [{ maxMinutes: Number, severity: String }] 
  },
  actions: [String],
  active: { type: Boolean, default: true }
});

module.exports = mongoose.model("RuleProfile", ruleProfileSchema);
