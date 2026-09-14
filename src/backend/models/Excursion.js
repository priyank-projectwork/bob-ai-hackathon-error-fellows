const mongoose = require("mongoose");

const excursionSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true },
  deviceId: { type: String }, // optional for now
  ruleProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'RuleProfile' },
  startedAt: { type: Date },
  endedAt: { type: Date },
  peakTempC: { type: Number },
  minTempC: { type: Number },
  durationSec: { type: Number },
  severity: { type: String, enum: ["None", "Warning", "Minor", "Major", "Critical"] },
  status: { type: String, enum: ["Open", "Closed"], default: "Open" }
});

module.exports = mongoose.model("Excursion", excursionSchema);
