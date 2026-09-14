const mongoose = require("mongoose");
const Shipment = require("./models/Shipment");
const FleetAsset = require("./models/FleetAsset");
const RuleProfile = require("./models/RuleProfile");
const RouteLeg = require("./models/RouteLeg");
const Disruption = require("./models/Disruption");
const SensorLog = require("./models/SensorLog");

const MONGO_URI = "mongodb://127.0.0.1:27017/bob-logistics-hackathon";

const seedData = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected for seeding");

    await Shipment.deleteMany({});
    await FleetAsset.deleteMany({});
    await RuleProfile.deleteMany({});
    await RouteLeg.deleteMany({});
    await Disruption.deleteMany({});
    console.log("Cleared existing data");

    // 1. Create Rule Profile for Vaccine
    const vaccineProfile = new RuleProfile({
      name: "Standard Vaccine Profile",
      version: "1.0",
      productType: "Vaccine",
      minTempC: 2.0,
      maxTempC: 8.0,
      warningBand: 1.0, // 1 degree from bounds is a warning
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

    // 2. Create Shipments and Route Legs
    const shipments = [];
    const routeLegs = [];
    const now = new Date();
    const deliveryDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 hours from now

    for (let i = 1; i <= 5; i++) {
      const shipment = new Shipment({
        shipmentId: `SHIP-MVP-10${i}`,
        cargoType: "Vaccine",
        cargoValue: 500000,
        priority: "Critical",
        origin: "New York",
        destination: "Los Angeles",
        currentLocation: { 
          lat: 33.70 + (Math.random() * 0.02), 
          lng: -118.29 + (Math.random() * 0.04) 
        },
        status: "In Transit",
        carrier: "FastLogistics",
        eta: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours from now
        deliveryDeadline: deliveryDeadline,
        tempProfileId: vaccineProfile._id,
        riskScore: 0,
        riskDrivers: []
      });

      // Create a dummy route leg from NY to LA
      const leg = new RouteLeg({
        shipmentId: shipment._id,
        sequenceNo: 1,
        mode: "Road",
        origin: "New York",
        destination: "Los Angeles",
        startLocation: { lat: 40.7128, lng: -74.0060 },
        endLocation: { lat: 34.0522, lng: -118.2437 },
        plannedStart: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        plannedEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        status: "Active",
        carrier: "FastLogistics"
      });
      routeLegs.push(leg);
      
      shipment.routeLegs.push(leg._id);
      shipments.push(shipment);
    }
    
    await Shipment.insertMany(shipments);
    await RouteLeg.insertMany(routeLegs);
    console.log("✅ Seeded 5 Shipments and Route Legs");

    // 3. Create Fleet Assets
    const fleets = [];
    for (let i = 1; i <= 5; i++) {
      fleets.push({
        assetId: `TRUCK-MVP-20${i}`,
        type: "Reefer Truck",
        status: "Idle",
        currentLocation: { 
          lat: 33.74 + (Math.random() * 0.02), 
          lng: -118.23 + (Math.random() * 0.03) 
        },
        locationName: "LA Port Logistics Center",
        capacityWeight: 10000,
        coldChainCapable: true,
        availableFrom: now,
        availableTo: new Date(now.getTime() + 72 * 60 * 60 * 1000)
      });
    }
    await FleetAsset.insertMany(fleets);
    console.log("✅ Seeded 5 FleetAssets");

    // 4. Create Historical Sensor Logs
    await SensorLog.deleteMany({});
    const sensorLogs = [];
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    for (let i = 0; i < 24; i++) { // 24 hours
      const timestamp = new Date(oneDayAgo.getTime() + i * 60 * 60 * 1000);
      for (const ship of shipments) {
        // Normal temperature with some noise
        const temp = 4.0 + (Math.random() * 2.0 - 1.0); 
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
    console.log("✅ Seeded 24 hours of Historical Sensor Logs");

    mongoose.connection.close();
    console.log("✅ Seeding complete, connection closed");
  } catch (err) {
    console.error("❌ Error seeding database:", err);
    mongoose.connection.close();
  }
};

seedData();
