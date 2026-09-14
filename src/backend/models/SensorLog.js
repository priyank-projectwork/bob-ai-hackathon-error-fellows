const mongoose = require("mongoose");

const sensorLogSchema = new mongoose.Schema({
  deviceId: { type: String }, // Optional, can be same as shipmentId for demo
  shipmentId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }, // recordedAt
  temperatureCelsius: Number,
  humidityPct: Number,
  latitude: Number,
  longitude: Number,
  qualityFlag: String,
  
  // Legacy fields for backward compatibility during transition
  isExcursion: Boolean,
  regulatorySeverity: String,
});

module.exports = mongoose.model("SensorLog", sensorLogSchema);
