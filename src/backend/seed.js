const mongoose = require("mongoose");
const Shipment = require("./models/Shipment");
const FleetAsset = require("./models/FleetAsset");
const RuleProfile = require("./models/RuleProfile");
const RouteLeg = require("./models/RouteLeg");
const Disruption = require("./models/Disruption");
const SensorLog = require("./models/SensorLog");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bob-logistics-hackathon";

const seedData = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected for seeding");

    await Shipment.deleteMany({});
    await FleetAsset.deleteMany({});
    await RuleProfile.deleteMany({});
    await RouteLeg.deleteMany({});
    await Disruption.deleteMany({});
    await SensorLog.deleteMany({});
    console.log("Cleared existing data");

    // ── Rule Profiles ─────────────────────────────────────────────────────
    const vaccineProfile = new RuleProfile({
      name: "Standard Vaccine Profile",
      version: "1.0",
      productType: "Vaccine",
      minTempC: 2.0,
      maxTempC: 8.0,
      warningBand: 1.0,
      durationRules: {
        thresholds: [
          { maxMinutes: 15, severity: "Minor" },
          { maxMinutes: 30, severity: "Major" },
          { maxMinutes: 60, severity: "Critical" }
        ]
      },
      actions: ["Alert Quality", "Hold at Destination"],
      active: true
    });
    await vaccineProfile.save();
    console.log("✅ Seeded Vaccine Rule Profile v1.0");

    // ── Shipment definitions — spread across 3 US corridors ──────────────
    const now = new Date();

    const shipmentDefs = [
      // LA corridor — 2 shipments near Los Angeles (will be hit by Port Strike)
      {
        id: "SHIP-MVP-101",
        origin: "New York",
        destination: "Los Angeles",
        currentLat: 33.72 + Math.random() * 0.02,
        currentLng: -118.28 + Math.random() * 0.03,
        legStart: { lat: 40.7128, lng: -74.0060 },   // New York
        legEnd:   { lat: 34.0522, lng: -118.2437 },  // LA
        etaHours: 4,   // tight deadline — high pressure
        deadlineHours: 6,
      },
      {
        id: "SHIP-MVP-102",
        origin: "New York",
        destination: "Los Angeles",
        currentLat: 33.70 + Math.random() * 0.02,
        currentLng: -118.25 + Math.random() * 0.03,
        legStart: { lat: 40.7128, lng: -74.0060 },
        legEnd:   { lat: 34.0522, lng: -118.2437 },
        etaHours: 8,
        deadlineHours: 12,
      },
      // Chicago corridor — 1 shipment near Chicago (will be hit by Blizzard)
      {
        id: "SHIP-MVP-103",
        origin: "New York",
        destination: "Chicago",
        currentLat: 41.86 + Math.random() * 0.03,
        currentLng: -87.62 + Math.random() * 0.03,
        legStart: { lat: 40.7128, lng: -74.0060 },  // New York
        legEnd:   { lat: 41.8781, lng: -87.6298 },  // Chicago
        etaHours: 3,   // very tight
        deadlineHours: 5,
      },
      // Miami corridor — 1 shipment near Miami (will be hit by Hurricane)
      {
        id: "SHIP-MVP-104",
        origin: "Atlanta",
        destination: "Miami",
        currentLat: 25.77 + Math.random() * 0.02,
        currentLng: -80.18 + Math.random() * 0.02,
        legStart: { lat: 33.749, lng: -84.388 },    // Atlanta
        legEnd:   { lat: 25.7617, lng: -80.1918 },  // Miami
        etaHours: 5,
        deadlineHours: 8,
      },
      // Denver corridor — 1 shipment en route (not near any disruption — baseline)
      {
        id: "SHIP-MVP-105",
        origin: "Chicago",
        destination: "Denver",
        currentLat: 39.73 + Math.random() * 0.02,
        currentLng: -104.98 + Math.random() * 0.02,
        legStart: { lat: 41.8781, lng: -87.6298 },  // Chicago
        legEnd:   { lat: 39.7392, lng: -104.9903 }, // Denver
        etaHours: 12,
        deadlineHours: 20,
      },
    ];

    const shipments = [];
    const routeLegs = [];

    for (const def of shipmentDefs) {
      const shipment = new Shipment({
        shipmentId: def.id,
        cargoType: "Vaccine",
        cargoValue: 500000,
        priority: "Critical",
        origin: def.origin,
        destination: def.destination,
        currentLocation: { lat: def.currentLat, lng: def.currentLng },
        status: "In Transit",
        carrier: "FastLogistics",
        eta: new Date(now.getTime() + def.etaHours * 60 * 60 * 1000),
        deliveryDeadline: new Date(now.getTime() + def.deadlineHours * 60 * 60 * 1000),
        tempProfileId: vaccineProfile._id,
        riskScore: 0,
        riskDrivers: []
      });

      const leg = new RouteLeg({
        shipmentId: shipment._id,
        sequenceNo: 1,
        mode: "Road",
        origin: def.origin,
        destination: def.destination,
        startLocation: def.legStart,
        endLocation: def.legEnd,
        plannedStart: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        plannedEnd: new Date(now.getTime() + def.etaHours * 60 * 60 * 1000),
        status: "Active",
        carrier: "FastLogistics"
      });

      routeLegs.push(leg);
      shipment.routeLegs.push(leg._id);
      shipments.push(shipment);
    }

    await Shipment.insertMany(shipments);
    await RouteLeg.insertMany(routeLegs);
    console.log("✅ Seeded 5 Shipments across LA/Chicago/Miami/Denver corridors");

    // ── Fleet Assets — spread near each corridor ─────────────────────────
    const fleetDefs = [
      // LA area — 2 reefer trucks (available for LA Port Strike rerouting)
      { id: "TRUCK-MVP-201", lat: 33.74, lng: -118.23, loc: "LA Port Logistics Center" },
      { id: "TRUCK-MVP-202", lat: 33.76, lng: -118.21, loc: "LA Inland Distribution Hub" },
      // Chicago area — 1 reefer truck
      { id: "TRUCK-MVP-203", lat: 41.90, lng: -87.65, loc: "Chicago O'Hare Freight Depot" },
      // Miami area — 1 reefer truck
      { id: "TRUCK-MVP-204", lat: 25.80, lng: -80.20, loc: "Miami International Cargo Terminal" },
      // Denver — 1 reefer truck (neutral, available for redeployment)
      { id: "TRUCK-MVP-205", lat: 39.75, lng: -104.99, loc: "Denver Distribution Center" },
    ];

    const fleets = fleetDefs.map((f) => ({
      assetId: f.id,
      type: "Reefer Truck",
      status: "Idle",
      currentLocation: { lat: f.lat, lng: f.lng },
      locationName: f.loc,
      capacityWeight: 10000,
      coldChainCapable: true,
      availableFrom: now,
      availableTo: new Date(now.getTime() + 72 * 60 * 60 * 1000)
    }));

    await FleetAsset.insertMany(fleets);
    console.log("✅ Seeded 5 FleetAssets across LA/Chicago/Miami/Denver");

    // ── Historical Sensor Logs — 24 hours of data ────────────────────────
    const sensorLogs = [];
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (let i = 0; i < 24; i++) {
      const timestamp = new Date(oneDayAgo.getTime() + i * 60 * 60 * 1000);
      for (const ship of shipments) {
        const temp = +(4.0 + (Math.random() * 2.0 - 1.0)).toFixed(2);
        sensorLogs.push(new SensorLog({
          shipmentId: ship.shipmentId,
          timestamp,
          temperatureCelsius: temp,
          humidityPercent: 40 + Math.random() * 10,
          location: ship.currentLocation
        }));
      }
    }

    await SensorLog.insertMany(sensorLogs);
    console.log("✅ Seeded 24 hours of Historical Sensor Logs (120 readings across 5 shipments)");

    mongoose.connection.close();
    console.log("✅ Seeding complete — LA/Chicago/Miami/Denver corridors ready");
    console.log("   → LA Port Strike  : affects SHIP-MVP-101, SHIP-MVP-102");
    console.log("   → Chicago Blizzard: affects SHIP-MVP-103");
    console.log("   → Miami Hurricane : affects SHIP-MVP-104");
    console.log("   → SHIP-MVP-105    : unaffected baseline (Denver corridor)");
  } catch (err) {
    console.error("❌ Error seeding database:", err);
    mongoose.connection.close();
  }
};

seedData();
