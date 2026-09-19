const mongoose = require("mongoose");

/**
 * A fleet asset. v2 adds what the matcher actually needs to make a physically
 * honest decision: which modes it can serve (so a truck is never matched to a
 * mid-ocean vessel), how long it needs to pre-cool before loading, how many
 * driver hours are left, and what idling costs.
 */
const fleetAssetSchema = new mongoose.Schema({
  assetId: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: ["Truck", "Vessel", "Plane", "Reefer Truck", "Reefer Container", "Air ULD"],
    required: true,
  },
  status: { type: String, enum: ["Active", "Idle", "Maintenance", "Assigned"], default: "Idle" },
  currentLocation: { lat: Number, lng: Number },
  locationName: { type: String },
  homeBase: { type: String },
  capacityWeight: { type: Number },
  coldChainCapable: { type: Boolean, default: false },

  // ── v2 ────────────────────────────────────────────────────────────────────
  minTempC: { type: Number },
  maxTempC: { type: Number },
  modes: { type: [String], default: ["Road"] },   // Road | Sea | Air | Rail
  preCoolHours: { type: Number, default: 0 },     // added to any rescue ETA
  costPerIdleHourUsd: { type: Number },
  costPerKmUsd: { type: Number },
  idleSinceMs: { type: Number },                  // null unless idle
  driverHoursRemaining: { type: Number },
  maintenanceDueMs: { type: Number },
  unitHealth: { type: String, enum: ["ok", "degraded", "fault"], default: "ok" },
  assignedShipmentId: { type: String },

  availableFrom: { type: Date },
  availableTo: { type: Date },
});

module.exports = mongoose.model("FleetAsset", fleetAssetSchema);
