const mongoose = require("mongoose");

const fleetAssetSchema = new mongoose.Schema({
  assetId: { type: String, required: true },
  type: { type: String, enum: ["Truck", "Vessel", "Plane", "Reefer Truck"], required: true },
  status: { type: String, enum: ["Active", "Idle", "Maintenance", "Assigned"], default: "Idle" },
  currentLocation: { lat: Number, lng: Number },
  locationName: { type: String },
  capacityWeight: { type: Number },
  coldChainCapable: { type: Boolean, default: false },
  availableFrom: { type: Date },
  availableTo: { type: Date }
});

module.exports = mongoose.model("FleetAsset", fleetAssetSchema);
