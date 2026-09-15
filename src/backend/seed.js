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

    // Named city coordinates
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
      shanghai:     { lat: 31.2304, lng: 121.4737 }, // Shanghai Yangshan Port
    };

    const shipmentDefs = [
      // ── LA Port Strike scenario ─────────────────────────────────────────────
      // SHIP-101: Pfizer mRNA vaccine, New York → Los Angeles via I-40 corridor
      //   Road truck. Currently on I-40 near Albuquerque NM (~1 day out from LA).
      //   Very tight deadline — 3h ETA, 2h buffer.
      //   Reroute: air freight from Albuquerque → LA airport bypasses the port.
      {
        id: "SHIP-MVP-101",
        cargoType: "Vaccine",
        cargoValue: 850000,
        priority: "Critical",
        carrier: "ColdExpress Logistics",
        origin: "New York",
        destination: "Los Angeles",
        // On I-40 near Albuquerque, NM — real midpoint NY→LA road corridor
        currentLat: 35.08,
        currentLng: -106.65,
        legStart: CITIES.newYork,
        legEnd:   CITIES.losAngeles,
        etaHours: 18,         // 18h out from LA
        deadlineHours: 20,    // 2h slack — very tight
        mode: "Road",
      },

      // SHIP-102: Insulin biologics, Houston → Los Angeles via I-10 West
      //   Road truck. Currently on I-10 near El Paso TX — real halfway point.
      //   7h to LA, 7h buffer. Reroute: inland bypass via San Diego.
      {
        id: "SHIP-MVP-102",
        cargoType: "Vaccine",
        cargoValue: 320000,
        priority: "High",
        carrier: "MedFreight Inc",
        origin: "Houston",
        destination: "Los Angeles",
        // On I-10 near El Paso, TX — real midpoint Houston→LA
        currentLat: 31.77,
        currentLng: -106.50,
        legStart: CITIES.houston,
        legEnd:   CITIES.losAngeles,
        etaHours: 12,         // 12h out from LA
        deadlineHours: 19,    // 7h slack
        mode: "Road",
      },

      // ── Chicago Blizzard scenario ───────────────────────────────────────────
      // SHIP-103: Flu vaccine, New York → Chicago via I-90 (Indiana Toll Road)
      //   Road truck. Currently on I-90 near Cleveland OH — about 5h from Chicago.
      //   Blizzard blocks I-90/I-94 at Chicago. Reroute: south via St. Louis.
      {
        id: "SHIP-MVP-103",
        cargoType: "Vaccine",
        cargoValue: 410000,
        priority: "Critical",
        carrier: "ArcticFreight LLC",
        origin: "New York",
        destination: "Chicago",
        // On I-90 near Cleveland, OH — real midpoint NY→Chicago
        currentLat: 41.50,
        currentLng: -81.69,
        legStart: CITIES.newYork,
        legEnd:   CITIES.chicago,
        etaHours: 5,          // 5h out from Chicago
        deadlineHours: 7,
        mode: "Road",
      },

      // ── Miami Hurricane scenario ────────────────────────────────────────────
      // SHIP-104: BCG vaccine, Atlanta → Miami via I-75 South
      //   Road truck. Currently on I-75 near Gainesville FL — about 3h from Miami.
      //   Hurricane makes landfall at Miami. Reroute: hold at Atlanta cold storage.
      {
        id: "SHIP-MVP-104",
        cargoType: "Vaccine",
        cargoValue: 190000,
        priority: "High",
        carrier: "SouthernCold Transport",
        origin: "Atlanta",
        destination: "Miami",
        // On I-75 near Gainesville, FL — real midpoint Atlanta→Miami
        currentLat: 29.65,
        currentLng: -82.33,
        legStart: CITIES.atlanta,
        legEnd:   CITIES.miami,
        etaHours: 3,
        deadlineHours: 6,
        mode: "Road",
      },

      // ── Baseline — unaffected ───────────────────────────────────────────────
      // SHIP-105: Medical supplies, Chicago → Denver via I-80 West
      //   Road truck. Currently on I-80 near Des Moines IA — real midpoint.
      //   No disruption on this corridor.
      {
        id: "SHIP-MVP-105",
        cargoType: "Standard",
        cargoValue: 75000,
        priority: "Medium",
        carrier: "MidWest Freight Co",
        origin: "Chicago",
        destination: "Denver",
        // On I-80 near Des Moines, IA — real midpoint Chicago→Denver
        currentLat: 41.59,
        currentLng: -93.62,
        legStart: CITIES.chicago,
        legEnd:   CITIES.denver,
        etaHours: 10,
        deadlineHours: 20,
        mode: "Road",
      },

      // ── LA Port Strike scenario — Ocean Vessel ──────────────────────────────
      // SHIP-106: Container ship, Shanghai Yangshan Port → LA/Long Beach Port
      //   Carrying mRNA vaccine cold-packs in refrigerated containers (reefer).
      //   Currently ~1,200 nautical miles west of LA (roughly 18h at 15 knots).
      //   LA Port Strike: cannot dock → divert to San Diego or Oakland.
      //   Real Pacific shipping lane: Great Circle route, passes north of Hawaii.
      {
        id: "SHIP-MVP-106",
        cargoType: "Vaccine",
        cargoValue: 1200000,
        priority: "Critical",
        carrier: "Pacific Shipping Lines",
        origin: "Shanghai",
        destination: "Los Angeles",
        // ~1,200 nm west of LA on the North Pacific Great Circle route
        // Real position: approx 34°N 138°W (between Hawaii and California)
        currentLat: 34.10,
        currentLng: -138.00,
        legStart: CITIES.shanghai,
        legEnd:   CITIES.losAngeles,
        etaHours: 18,         // 18h at ~15 knots
        deadlineHours: 24,    // 6h cold-chain slack
        mode: "Ocean",
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
        mode: def.mode || "Road",
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
    console.log("✅ Seeded 6 Shipments across LA/Chicago/Miami/Denver corridors (+ Pacific Ocean vessel)");

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
    console.log("✅ Seeding complete — all corridors ready");
    console.log("   → LA Port Strike  : affects SHIP-MVP-101, SHIP-MVP-102, SHIP-MVP-106 (ocean)");
    console.log("   → Chicago Blizzard: affects SHIP-MVP-103");
    console.log("   → Miami Hurricane : affects SHIP-MVP-104");
    console.log("   → SHIP-MVP-105    : unaffected baseline (Denver corridor)");
  } catch (err) {
    console.error("❌ Error seeding database:", err);
    mongoose.connection.close();
  }
};

seedData();
