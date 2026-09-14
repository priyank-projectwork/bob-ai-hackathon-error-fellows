const mongoose = require("mongoose");

const auditEventSchema = new mongoose.Schema({
  actorType: { type: String }, // e.g. "Operations Control Tower Manager", "System"
  actorId: { type: String },
  eventType: { type: String }, // e.g. "ApproveReroute", "RejectRecommendation"
  entityType: { type: String },
  entityId: { type: String },
  payload: { type: Object },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("AuditEvent", auditEventSchema);
