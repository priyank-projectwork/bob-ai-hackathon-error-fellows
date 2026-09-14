const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const EventEmitter = require("events");
const cors = require("cors");

// Models
const SensorLog = require("./models/SensorLog");
const FleetAsset = require("./models/FleetAsset");
const Shipment = require("./models/Shipment");
const RuleProfile = require("./models/RuleProfile");
const Excursion = require("./models/Excursion");
const Alert = require("./models/Alert");
const Recommendation = require("./models/Recommendation");
const AuditEvent = require("./models/AuditEvent");
const Disruption = require("./models/Disruption");
const RouteLeg = require("./models/RouteLeg");

// Engines
const { calculateDisruptionImpact } = require("./engines/impactEngine");
const { calculateShipmentRisk, getRiskBand } = require("./engines/riskEngine");
const { evaluateTelemetry } = require("./engines/coldChainEngine");
const { getRouteAlternatives } = require("./engines/routeOptimizer");
const { rankFleetMatches } = require("./engines/fleetMatcher");

// AI Service
const { evaluateActionWithAI, processChatQuery } = require("./aiService");

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const MONGO_URI = "mongodb://127.0.0.1:27017/bob-logistics-hackathon";
mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB connected"));

// Internal Event Bus (Mocking BullMQ/Redis)
const eventBus = new EventEmitter();

io.on("connection", (socket) => {
  console.log("💻 Client connected:", socket.id);
});

// ---------------------------------------------------------
// EVENT CONSUMERS
// ---------------------------------------------------------

eventBus.on("disruption.created", async (disruption) => {
  console.log(`[Event] disruption.created: ${disruption.title}`);
  
  // 1. Impact Engine
  const shipments = await Shipment.find({ status: "In Transit" }).populate("routeLegs");
  const impactedShipments = [];
  const availableFleets = await FleetAsset.find({ status: "Idle" });

  for (const shipment of shipments) {
    const impact = calculateDisruptionImpact(shipment, shipment.routeLegs, disruption);
    
    if (impact.isImpacted) {
      // 2. Risk Engine
      const risk = calculateShipmentRisk(shipment, impact.exposureScore, 24, 0);
      shipment.riskScore = risk.score;
      shipment.riskDrivers = risk.riskDrivers;
      await shipment.save();
      impactedShipments.push(shipment);
      
      // 3. Optimization & Matching
      const alternatives = getRouteAlternatives(shipment.origin, shipment.destination, [disruption]);
      const matches = rankFleetMatches(shipment, availableFleets);
      
      let selectedFleet = null;
      if (matches.length > 0) {
        selectedFleet = matches[0];
        // Remove this fleet so it's not assigned to the next impacted shipment
        const index = availableFleets.findIndex(f => f.assetId === selectedFleet.fleet.assetId);
        if (index !== -1) availableFleets.splice(index, 1);
      }
      
      // 4. Create Recommendation (AI as explainer would happen here or downstream)
      const rec = new Recommendation({
        entityType: "Shipment",
        entityId: shipment.shipmentId,
        recommendationType: "Reroute & Assign Fleet",
        score: alternatives[0].riskScore,
        confidence: 85,
        rationale: alternatives[0].rationale + (selectedFleet ? ` Matches with idle asset ${selectedFleet.fleet.assetId}.` : ""),
        evidence: {
          alternateRoute: alternatives[0],
          fleetMatch: selectedFleet || null
        }
      });
      await rec.save();
      io.emit("recommendation.created", rec);
    }
  }
  
  io.emit("disruption.updated", { disruption, impactedCount: impactedShipments.length });
});

eventBus.on("sensor.reading.received", async (log) => {
  // Validate telemetry + excursion evaluation
  const shipment = await Shipment.findOne({ shipmentId: log.shipmentId });
  if (!shipment) return;
  
  const ruleProfile = await RuleProfile.findById(shipment.tempProfileId);
  if (!ruleProfile) return;

  const openExcursion = await Excursion.findOne({ shipmentId: log.shipmentId, status: "Open" });
  
  const evalResult = evaluateTelemetry(log, ruleProfile, openExcursion);
  
  if (evalResult.action === "OPEN_EXCURSION") {
    const exc = new Excursion({
      shipmentId: log.shipmentId,
      ruleProfileId: ruleProfile._id,
      startedAt: log.timestamp,
      peakTempC: log.temperatureCelsius,
      minTempC: log.temperatureCelsius,
      severity: evalResult.severity
    });
    await exc.save();
    
    const alert = new Alert({
      severity: evalResult.severity === "Critical" ? "Critical" : "High",
      entityType: "Excursion",
      entityId: exc._id,
      title: "Cold Chain Breach Detected",
      message: `Temperature ${log.temperatureCelsius}°C exceeded limits for ${shipment.shipmentId}`
    });
    await alert.save();
    io.emit("telemetry.alert", alert);
    
  } else if (evalResult.action === "UPDATE_EXCURSION" && openExcursion) {
    openExcursion.peakTempC = Math.max(openExcursion.peakTempC, log.temperatureCelsius);
    openExcursion.minTempC = Math.min(openExcursion.minTempC, log.temperatureCelsius);
    
    if (evalResult.severity !== openExcursion.severity) {
      openExcursion.severity = evalResult.severity;
      
      const alert = new Alert({
        severity: evalResult.severity === "Critical" ? "Critical" : "High",
        entityType: "Excursion",
        entityId: openExcursion._id,
        title: "Cold Chain Severity Escalated",
        message: `Excursion severity for ${shipment.shipmentId} escalated to ${evalResult.severity}`
      });
      await alert.save();
      io.emit("telemetry.alert", alert);
    }
    await openExcursion.save();
  } else if (evalResult.action === "RESOLVE_EXCURSION" && openExcursion) {
    openExcursion.status = "Closed";
    openExcursion.endedAt = log.timestamp;
    await openExcursion.save();
    io.emit("excursion.resolved", openExcursion);
  }
});


// ---------------------------------------------------------
// SIMULATOR
// ---------------------------------------------------------
let simulationInterval = null;
const startSimulation = async () => {
  if (simulationInterval) clearInterval(simulationInterval);
  console.log("🌡️ Starting mock IoT temperature stream (every 5s)...");

  // Fetch standard profile for generating mock data
  const profile = await RuleProfile.findOne({ productType: "Vaccine" });

  simulationInterval = setInterval(async () => {
    if (mongoose.connection.readyState !== 1) return;

    try {
      const activeShipments = await Shipment.find({ status: "In Transit" });
      if (activeShipments.length === 0) return;
      const targetShipment = activeShipments[Math.floor(Math.random() * activeShipments.length)];

      const isSimulatedSpike = Math.random() < 0.25;
      const currentTemp = isSimulatedSpike
        ? +(8.5 + Math.random() * 5.5).toFixed(2)
        : +(3.0 + Math.random() * 3.5).toFixed(2);

      const newLog = new SensorLog({
        shipmentId: targetShipment.shipmentId, // Pick a random active shipment
        temperatureCelsius: currentTemp,
      });
      await newLog.save();
      
      eventBus.emit("sensor.reading.received", newLog);
      io.emit("temperatureUpdate", newLog); 
    } catch (err) {
      console.error("❌ Error saving sensor log:", err.message);
    }
  }, 5000);
};

// ---------------------------------------------------------
// API ENDPOINTS
// ---------------------------------------------------------

app.get("/api/locations", async (req, res) => {
  try {
    const shipments = await Shipment.find({ status: "In Transit" }).populate("routeLegs");
    const fleets = await FleetAsset.find({ status: "Idle" });
    const disruptions = await Disruption.find({ status: "Active" });
    res.json({ shipments, fleets, disruptions });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

// Mocking "Operations Control Tower Manager" via header or just hardcoded.
const getMockUser = () => ({ actorType: "Operations Control Tower Manager", actorId: "admin-123" });

app.get("/api/v1/command-center", async (req, res) => {
  const activeDisruptions = await Disruption.find({ status: "Active" });
  const idleFleets = await FleetAsset.find({ status: "Idle" });
  const openAlerts = await Alert.find({ status: "Open" }).sort({ createdAt: -1 });
  const pendingRecs = await Recommendation.find({ status: "Pending" });
  const shipments = await Shipment.find();
  
  const kpis = {
    activeDisruptions: activeDisruptions.length,
    idleAssets: idleFleets.length,
    criticalShipments: shipments.filter(s => getRiskBand(s.riskScore) === "CRITICAL").length,
    openColdChainAlerts: openAlerts.filter(a => a.entityType === "Excursion").length
  };
  
  res.json({ kpis, alerts: openAlerts, recommendations: pendingRecs });
});

app.get("/api/analytics/temperature", async (req, res) => {
  try {
    const logs = await SensorLog.find().sort({ timestamp: 1 });
    
    // Group logs by hour
    const hourlyData = {};
    for (const log of logs) {
      const hourStr = new Date(log.timestamp).toISOString().slice(0, 13) + ":00:00Z";
      if (!hourlyData[hourStr]) {
        hourlyData[hourStr] = { time: new Date(hourStr).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), avgTemp: 0, count: 0 };
      }
      hourlyData[hourStr].avgTemp += log.temperatureCelsius;
      hourlyData[hourStr].count += 1;
    }
    
    const chartData = Object.values(hourlyData).map(d => ({
      time: d.time,
      temp: parseFloat((d.avgTemp / d.count).toFixed(2))
    }));
    
    res.json({ data: chartData });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

app.post("/api/disruptions", async (req, res) => {
  try {
    const { disruptionType, location } = req.body;

    const existingDisruption = await Disruption.findOne({
      status: "Active",
      type: disruptionType,
      "geometry.locationName": location
    });

    if (existingDisruption) {
      return res.json({ success: true, disruption: existingDisruption });
    }

    // Dynamic coordinates based on location
    let lat = 33.74;
    let lng = -118.25;
    if (location.includes("Chicago")) {
      lat = 41.8781;
      lng = -87.6298;
    } else if (location.includes("Miami")) {
      lat = 25.7617;
      lng = -80.1918;
    } else if (location.includes("New York")) {
      lat = 40.7128;
      lng = -74.0060;
    }

    const newDisruption = new Disruption({
      type: disruptionType,
      title: `${disruptionType} at ${location}`,
      severity: "High",
      geometry: { locationName: location, lat, lng, radius: 4500 },
      startAt: new Date(),
      status: "Active",
      source: "Manual Entry"
    });
    
    await newDisruption.save();
    
    // Trigger async event
    eventBus.emit("disruption.created", newDisruption);
    
    // Audit
    const user = getMockUser();
    await new AuditEvent({
      actorType: user.actorType, actorId: user.actorId,
      eventType: "CreateDisruption", entityType: "Disruption", entityId: newDisruption._id,
      payload: { type: disruptionType, location }
    }).save();

    res.json({ success: true, disruption: newDisruption });
  } catch (error) {
    res.status(500).json({ error: "Failed to process disruption" });
  }
});

app.post("/api/v1/recommendations/:id/approve", async (req, res) => {
  try {
    const rec = await Recommendation.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recommendation not found" });
    
    // Apply changes (mock execution)
    rec.status = "Approved";
    await rec.save();
    
    if (rec.evidence && rec.evidence.fleetMatch) {
      const fleetAssetId = rec.evidence.fleetMatch.fleet.assetId;
      await FleetAsset.updateOne({ assetId: fleetAssetId }, { status: "In Transit" });
    }
    
    const user = getMockUser();
    await new AuditEvent({
      actorType: user.actorType, actorId: user.actorId,
      eventType: "ApproveRecommendation", entityType: "Recommendation", entityId: rec._id,
      payload: { rationale: rec.rationale }
    }).save();
    
    io.emit("action.completed", { recommendation: rec });
    res.json({ success: true, message: "Action approved and audit logged." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/chat", async (req, res) => {
  try {
    const { message } = req.body;
    
    // Gather system state for context
    const shipments = await Shipment.find({ status: "In Transit" }, { shipmentId: 1, currentLat: 1, currentLng: 1, riskScore: 1 }).lean();
    const disruptions = await Disruption.find({ status: "Active" }, { type: 1, title: 1, locationName: 1, severity: 1 }).lean();
    const idleFleets = await FleetAsset.find({ status: "Idle" }, { assetId: 1, locationName: 1, capacityWeight: 1 }).lean();
    
    const contextData = {
      activeDisruptions: disruptions,
      inTransitShipmentsCount: shipments.length,
      shipments: shipments,
      idleFleetsCount: idleFleets.length,
      idleFleets: idleFleets
    };

    const reply = await processChatQuery(message, contextData);
    
    res.json({ reply });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({ error: "Failed to process chat query" });
  }
});

mongoose.connection.once("open", () => {
  startSimulation();
});

server.listen(4000, () => {
  console.log("🚀 Server running on http://127.0.0.1:4000");
});

