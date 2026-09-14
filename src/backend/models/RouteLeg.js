const mongoose = require("mongoose");

const routeLegSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
  sequenceNo: { type: Number },
  mode: { type: String, enum: ["Road", "Sea", "Air", "Rail"] },
  origin: { type: String },
  destination: { type: String },
  startLocation: { lat: Number, lng: Number },
  endLocation: { lat: Number, lng: Number },
  plannedStart: { type: Date },
  plannedEnd: { type: Date },
  actualStart: { type: Date },
  actualEnd: { type: Date },
  carrier: { type: String },
  status: { type: String, enum: ["Pending", "Active", "Completed", "Disrupted"], default: "Pending" }
});

module.exports = mongoose.model("RouteLeg", routeLegSchema);
