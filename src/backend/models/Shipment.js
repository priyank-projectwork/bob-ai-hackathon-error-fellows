const mongoose = require("mongoose");

const shipmentSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true }, // acts as tracking_no
  cargoType: { type: String, enum: ["Standard", "Perishable", "Vaccine"], required: true },
  cargoValue: { type: Number },
  priority: { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Medium" },
  
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  currentLocation: { lat: Number, lng: Number },
  
  status: {
    type: String,
    enum: ["In Transit", "Delayed", "Disrupted", "Delivered", "Hold"],
    default: "In Transit"
  },
  
  eta: { type: Date },
  deliveryDeadline: { type: Date },
  
  carrier: { type: String },
  tempProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'RuleProfile' },
  
  // Array of route legs can also be stored as references or embedded
  routeLegs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'RouteLeg' }],
  riskScore: { type: Number, default: 0 },
  riskDrivers: [String]
});

module.exports = mongoose.model("Shipment", shipmentSchema);
