const mongoose = require("mongoose");

const recommendationSchema = new mongoose.Schema({
  entityType: { type: String, enum: ["Shipment", "FleetAsset", "Disruption"] },
  entityId: { type: String },
  recommendationType: { type: String },
  score: { type: Number },
  confidence: { type: Number },
  rationale: { type: String },
  evidence: { type: Object }, // generic object for storing structured evidence
  status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" }
});

module.exports = mongoose.model("Recommendation", recommendationSchema);
