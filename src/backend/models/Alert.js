const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema({
  severity: { type: String, enum: ["Normal", "Watch", "High", "Critical"] },
  entityType: { type: String, enum: ["Shipment", "FleetAsset", "Disruption", "Excursion"] },
  entityId: { type: String },
  title: { type: String },
  message: { type: String },
  status: { type: String, enum: ["Open", "Acknowledged", "Resolved"], default: "Open" },
  assignedTo: { type: String },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date },
  coalesceKey: { type: String, index: true },  // one open alert per problem
  repeatCount: { type: Number, default: 0 },
  acknowledgedBy: { type: String },
  acknowledgedAtMs: { type: Number },
});

module.exports = mongoose.model("Alert", alertSchema);
