const mongoose = require("mongoose");

const disruptionSchema = new mongoose.Schema({
  type: { type: String }, // e.g. "Port Strike", "Weather"
  title: { type: String },
  severity: { type: String, enum: ["Low", "Medium", "High", "Critical"] },
  geometry: {
    locationName: { type: String },
    lat: { type: Number },
    lng: { type: Number },
    radius: { type: Number }
  },
  startAt: { type: Date },
  expectedEndAt: { type: Date },
  status: { type: String, enum: ["Active", "Resolved"], default: "Active" },
  source: { type: String },
  sourceConfidence: { type: Number }
});

disruptionSchema.index({ status: 1 });

module.exports = mongoose.model("Disruption", disruptionSchema);
