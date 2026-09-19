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

// The analytics chart and the cold-chain window both query by shipment and
// time. Without these every read was a collection scan, and the simulator adds
// a document per shipment every ten simulated minutes.
sensorLogSchema.index({ shipmentId: 1, timestamp: -1 });
sensorLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model("SensorLog", sensorLogSchema);
