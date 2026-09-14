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
  resolvedAt: { type: Date }
});

module.exports = mongoose.model("Alert", alertSchema);
