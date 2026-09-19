const mongoose = require("mongoose");

/**
 * A temperature excursion, judged by the rule profile version in force when it
 * opened. `ruleProfileRef` is denormalised on purpose: re-classifying history
 * under a newer profile would silently rewrite a regulatory record.
 */
const excursionSchema = new mongoose.Schema({
  shipmentId: { type: String, index: true },
  ruleProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "RuleProfile" },
  ruleProfileRef: { profileKey: String, version: Number },

  status: { type: String, enum: ["Open", "Closed"], default: "Open", index: true },
  startedAt: { type: Number },   // epoch ms, simulated clock
  endedAt: { type: Number },
  durationMin: { type: Number, default: 0 },

  bandKey: { type: String },     // freeze | cold | warm | hot | extreme
  bandMinutes: { type: Object, default: {} },  // cumulative minutes per band
  peakTempC: { type: Number },
  minTempC: { type: Number },

  severity: { type: String, enum: ["None", "Warning", "Minor", "Major", "Critical"], default: "Warning" },
  severityCell: { type: mongoose.Schema.Types.Mixed },  // matrix cell the engine landed on
  irreversible: { type: Boolean, default: false },

  mktC: { type: Number, default: null },
  mktApplies: { type: Boolean, default: true },
  cumulativeFraction: { type: Number, default: 0 },

  rootCause: { code: String, evidence: [String], confidence: String },

  // Which leg and whose custody, so an excursion is attributable.
  legSequenceNo: { type: Number },
  custodyCarrier: { type: String },

  recommendedDisposition: { type: String },
  requiredRole: { type: String },

  // Signed off by a human; agents are refused by policy.
  disposition: {
    decision: { type: String, enum: ["release", "release_with_note", "quarantine_qa", "reject"] },
    signedBy: String,
    signedAtMs: Number,
    reason: String,
    auditHash: String,
  },

  productImpacting: { type: Boolean, default: false },
  rationale: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Excursion", excursionSchema);
