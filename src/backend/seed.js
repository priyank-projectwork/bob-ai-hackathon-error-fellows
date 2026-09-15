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

    // ── Shipment definitions ─────────────────────────────────────────────
    const now = new Date();

    // City coordinates used for route legs
    const CITIES = {
      newYork:      { lat: 40.7128, lng: -74.0060 },
      losAngeles:   { lat: 34.0522, lng: -118.2437 },
      chicago:      { lat: 41.8781, lng: -87.6298 },
      atlanta:      { lat: 33.7490, lng: -84.3880 },
      houston:      { lat: 29.7604, lng: -95.3698 },
      miami:        { lat: 25.7617, lng: -80.1918 },
      denver:       { lat: 39.7392, lng: -104.9903 },
      dallas:       { lat: 32.7767, lng: -96.7970 },
      philadelphia: { lat: 39.9526, lng: -75.1652 },
      sanDiego:     { lat: 32.7157, lng: -117.1611 },
    };

    const shipmentDefs = [
      // ── LA Port Strike scenario ─────────────────────────────────────────
      // SHIP-101: Pfizer mRNA vaccine, arriving LA via road, CRITICALLY tight deadline
      //   → best reroute: land-bridge via San Diego (avoids port entirely)
      {
        id: "SHIP-MVP-101",
        cargoType: "Vaccine",
        cargoValue: 850000,
        priority: "Critical",
        carrier: "ColdExpress Logistics",
        origin: "New York",
        destination: "Los Angeles",
        // Currently near LA — inside the port strike disruption zone
        currentLat: 33.73,
        currentLng: -118.26,
        legStart: CITIES.newYork,
        legEnd:   CITIES.losAngeles,
        etaHours: 3,          // very tight — arrives in 3h
        deadlineHours: 5,     // only 2h slack — high pressure
      },
      // SHIP-102: Insulin biologics from Houston via road, also heading to LA
      //   → different origin, lower urgency, different reroute ranks
      //   → best reroute: Denver air freight (cost acceptable for time savings)
      {
        id: "SHIP-MVP-102",
        cargoType: "Vaccine",
        cargoValue: 320000,
        priority: "High",
        carrier: "MedFreight Inc",
        origin: "Houston",
        destination: "Los Angeles",
        // Currently near LA via I-10 west — also inside disruption zone
        currentLat: 33.96,
        currentLng: -118.03,
        legStart: CITIES.houston,
        legEnd:   CITIES.losAngeles,
        etaHours: 7,          // 7h ETA
        deadlineHours: 14,    // 7h slack — moderate pressure
      },

      // ── Chicago Blizzard scenario ───────────────────────────────────────
      // SHIP-103: Flu vaccine, New York → Chicago, deep inside blizzard zone
      //   → best reroute: southern approach via St. Louis
      {
        id: "SHIP-MVP-103",
        cargoType: "Vaccine",
        cargoValue: 410000,
        priority: "Critical",
        carrier: "ArcticFreight LLC",
        origin: "New York",
        destination: "Chicago",
        currentLat: 41.87,
        currentLng: -87.64,
        legStart: CITIES.newYork,
        legEnd:   CITIES.chicago,
        etaHours: 2,          // almost there — extreme urgency
        deadlineHours: 4,
      },

      // ── Miami Hurricane scenario ────────────────────────────────────────
      // SHIP-104: BCG vaccine, Atlanta → Miami, storm track directly overhead
      //   → best reroute: stage at Atlanta cold storage until storm passes
      {
        id: "SHIP-MVP-104",
        cargoType: "Vaccine",
        cargoValue: 190000,
        priority: "High",
        carrier: "SouthernCold Transport",
        origin: "Atlanta",
        destination: "Miami",
        currentLat: 25.78,
        currentLng: -80.19,
        legStart: CITIES.atlanta,
        legEnd:   CITIES.miami,
        etaHours: 4,
        deadlineHours: 7,
      },

      // ── Baseline — unaffected ───────────────────────────────────────────
      // SHIP-105: Routine medical supplies, Chicago → Denver, no disruption
      {
        id: "SHIP-MVP-105",
        cargoType: "Standard",
        cargoValue: 75000,
        priority: "Medium",
        carrier: "MidWest Freight Co",
        origin: "Chicago",
        destination: "Denver",
        currentLat: 39.74,
        currentLng: -104.99,
        legStart: CITIES.chicago,
        legEnd:   CITIES.denver,
        etaHours: 14,
        deadlineHours: 24,
      },
    ];

    const shipments = [];
    const routeLegs = [];

    for (const def of shipmentDefs) {
      const shipment = new Shipment({
        shipmentId: def.id,
        cargoType: def.cargoType,
        cargoValue: def.cargoValue,
        priority: def.priority,
        origin: def.origin,
        destination: def.destination,
        currentLocation: { lat: def.currentLat, lng: def.currentLng },
        status: "In Transit",
        carrier: def.carrier,
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
        carrier: def.carrier
      });

      routeLegs.push(leg);
      shipment.routeLegs.push(leg._id);
      shipments.push(shipment);
    }

    await Shipment.insertMany(shipments);
    await RouteLeg.insertMany(routeLegs);
    console.log("✅ Seeded 5 Shipments across LA/Chicago/Miami/Denver corridors");

    // ── Fleet Assets ─────────────────────────────────────────────────────
    const fleetDefs = [
      // LA area — 2 idle reefers (available for Port Strike rerouting)
      { id: "TRUCK-MVP-201", lat: 33.94, lng: -118.03, loc: "LA East Inland Cold Hub (Ontario)" },
      { id: "TRUCK-MVP-202", lat: 32.71, lng: -117.16, loc: "San Diego Freight Terminal" },
      // Chicago area
      { id: "TRUCK-MVP-203", lat: 41.90, lng: -87.65, loc: "Chicago O'Hare Freight Depot" },
      // Miami area
      { id: "TRUCK-MVP-204", lat: 25.80, lng: -80.20, loc: "Miami International Cargo Terminal" },
      // Denver
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
