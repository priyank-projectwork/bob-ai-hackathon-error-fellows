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
  riskDrivers: [String],

  // ── motion (row 4) ──────────────────────────────────────────────────────────
  // Route as GeoJSON LineString coordinates: [[lng, lat], ...]. The simulated
  // world moves the shipment along these; impact detection tests only the part
  // still ahead. Populated by the lane builder and the seed.
  routeCoords: { type: [[Number]], default: undefined },
  speedKmh: { type: Number },            // mode speed for this shipment
  departedAt: { type: Date },            // when it started moving
  dwellHours: { type: Number, default: 0 },
  setpointC: { type: Number, default: 4 },
  corridorBiasC: { type: Number, default: 0 },
  transportMode: { type: String, enum: ["Road", "Sea", "Air", "Rail"], default: "Road" },
  needByAt: { type: Date },              // the schedule clock's deadline
  doses: { type: Number },
  declaredValueUsd: { type: Number }
});

shipmentSchema.index({ shipmentId: 1 }, { unique: true });
shipmentSchema.index({ status: 1 });

module.exports = mongoose.model("Shipment", shipmentSchema);
