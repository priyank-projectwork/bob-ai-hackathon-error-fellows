"use strict";
require("dotenv").config();
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
const { classifyExcursion, generateReroutingStrategy, processChatQuery, AI_ENABLED } = require("./aiService");

// Store
const { connectStore, getStoreMode } = require("./store/index");

// Middleware: reject DB-backed requests when store is "none"
function requireDb(req, res, next) {
  if (getStoreMode() === "none") {
    return res.status(503).json({ error: "database unavailable" });
  }
  next();
}

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });


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
  try {
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
        const alternatives = getRouteAlternatives(shipment.origin, shipment.destination, [disruption], shipment.priority);
        const matches = rankFleetMatches(shipment, availableFleets);

        let selectedFleet = null;
        if (matches.length > 0) {
          selectedFleet = matches[0];
          const index = availableFleets.findIndex(f => f.assetId === selectedFleet.fleet.assetId);
          if (index !== -1) availableFleets.splice(index, 1);
        }

        // 4. Create Recommendation — AI generates the explanation
        const idleFleetsList = availableFleets.slice(0, 3);
        const aiStrategy = await generateReroutingStrategy(
          disruption.type,
          disruption.geometry.locationName,
          impactedShipments,
          idleFleetsList
        );

        const rec = new Recommendation({
          entityType: "Shipment",
          entityId: shipment.shipmentId,
          recommendationType: "Reroute & Assign Fleet",
          score: risk.score,
          confidence: 85,
          rationale: aiStrategy.recommendedAction
            ? `${aiStrategy.recommendedAction} | Route: ${aiStrategy.alternateRoute || alternatives[0].rationale}` + (selectedFleet ? ` | Fleet: ${selectedFleet.fleet.assetId}` : "")
            : alternatives[0].rationale + (selectedFleet ? ` Matches with idle asset ${selectedFleet.fleet.assetId}.` : ""),
          evidence: {
            alternateRoute: alternatives[0],
            fleetMatch: selectedFleet || null,
            aiStrategy
          }
        });
        await rec.save();
        io.emit("recommendation.created", rec);
      }
    }

    io.emit("disruption.updated", { disruption, impactedCount: impactedShipments.length });
  } catch (err) {
    console.error("[Event] disruption.created handler error:", err);
    io.emit("disruption.updated", { disruption, impactedCount: 0 });
  }
});

eventBus.on("sensor.reading.received", async (log) => {
  const shipment = await Shipment.findOne({ shipmentId: log.shipmentId });
  if (!shipment) return;
  
  const ruleProfile = await RuleProfile.findById(shipment.tempProfileId);
  if (!ruleProfile) return;

  const openExcursion = await Excursion.findOne({ shipmentId: log.shipmentId, status: "Open" });
  const evalResult = evaluateTelemetry(log, ruleProfile, openExcursion);

  // Intervention window helper
  const hoursToDelivery = shipment.eta
    ? Math.max(0, (new Date(shipment.eta) - new Date()) / (1000 * 60 * 60))
    : null;
  const interventionNote = hoursToDelivery !== null
    ? hoursToDelivery > 1
      ? ` | ⏱ Delivery in ${hoursToDelivery.toFixed(1)}h — intervention window: ${(hoursToDelivery - 1).toFixed(1)}h`
      : ` | ⚠️ PAST intervention window — shipment arrives in <1h`
    : "";

  // Rule profile citation for regulatory traceability
  const profileCitation = `[${ruleProfile.name} v${ruleProfile.version}: ${ruleProfile.minTempC}°C–${ruleProfile.maxTempC}°C]`;
  
  if (evalResult.action === "WARNING") {
    // WARNING was silently dropped before — now emit a Watch-level alert
    const alert = new Alert({
      severity: "Watch",
      entityType: "Excursion",
      entityId: shipment._id,
      title: `Cold Chain Warning — ${shipment.shipmentId}`,
      message: `Temperature ${log.temperatureCelsius}°C approaching limit ${profileCitation}${interventionNote}`
    });
    await alert.save();
    io.emit("telemetry.alert", alert);

  } else if (evalResult.action === "OPEN_EXCURSION") {
    // Call watsonx.ai to classify severity + GDP-compliant recommended action
    const aiClassification = await classifyExcursion(log);
    const excursionSeverity = aiClassification.severity || evalResult.severity;

    const exc = new Excursion({
      shipmentId: log.shipmentId,
      ruleProfileId: ruleProfile._id,
      startedAt: log.timestamp,
      peakTempC: log.temperatureCelsius,
      minTempC: log.temperatureCelsius,
      severity: excursionSeverity
    });
    await exc.save();
    
    const alert = new Alert({
      severity: excursionSeverity === "Critical" ? "Critical" : "High",
      entityType: "Excursion",
      entityId: exc._id,
      title: `🌡️ ${excursionSeverity} Excursion — ${shipment.shipmentId}`,
      message: `${aiClassification.recommendedAction} ${profileCitation} @ ${log.temperatureCelsius}°C${interventionNote}`
    });
    await alert.save();
    io.emit("telemetry.alert", alert);

    // ── COMPOUND RISK: if this shipment is also inside an active disruption, escalate ──
    const activeDisruptions = await Disruption.find({ status: "Active" });
    for (const disruption of activeDisruptions) {
      const { calculateDisruptionImpact } = require("./engines/impactEngine");
      const legs = await require("./models/RouteLeg").find({ _id: { $in: shipment.routeLegs } });
      const impact = calculateDisruptionImpact(shipment, legs, disruption);
      if (impact.isImpacted) {
        // Both a disruption AND cold-chain excursion on the same shipment — escalate
        const compoundRisk = require("./engines/riskEngine").calculateShipmentRisk(
          shipment, impact.exposureScore, 24, 80
        );
        shipment.riskScore = compoundRisk.score;
        shipment.riskDrivers = [
          ...new Set([...compoundRisk.riskDrivers, `Active ${excursionSeverity} excursion`, `${disruption.type} disruption`])
        ];
        await shipment.save();

        const compoundAlert = new Alert({
          severity: "Critical",
          entityType: "Shipment",
          entityId: shipment.shipmentId,
          title: `⚡ DUAL RISK — ${shipment.shipmentId}`,
          message: `Disruption (${disruption.type}) + ${excursionSeverity} excursion converging. Risk escalated to ${compoundRisk.score}/100 CRITICAL.${interventionNote}`
        });
        await compoundAlert.save();
        io.emit("telemetry.alert", compoundAlert);
        break; // one compound alert per excursion opening
      }
    }
    
  } else if (evalResult.action === "UPDATE_EXCURSION" && openExcursion) {
    openExcursion.peakTempC = Math.max(openExcursion.peakTempC, log.temperatureCelsius);
    openExcursion.minTempC = Math.min(openExcursion.minTempC, log.temperatureCelsius);
    
    if (evalResult.severity !== openExcursion.severity) {
      openExcursion.severity = evalResult.severity;
      const alert = new Alert({
        severity: evalResult.severity === "Critical" ? "Critical" : "High",
        entityType: "Excursion",
        entityId: openExcursion._id,
        title: `🔺 Severity Escalated — ${shipment.shipmentId}`,
        message: `Excursion escalated to ${evalResult.severity} ${profileCitation}${interventionNote}`
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

      // 30% spike probability; spikes start above warning band (9.5°C) to guarantee excursion fires
      const isSimulatedSpike = Math.random() < 0.30;
      const currentTemp = isSimulatedSpike
        ? +(9.5 + Math.random() * 5.0).toFixed(2)   // 9.5–14.5°C — always triggers excursion
        : +(3.0 + Math.random() * 3.5).toFixed(2);  // 3.0–6.5°C — safe range

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

app.get("/api/locations", requireDb, async (req, res) => {
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

// ── Actor identity ───────────────────────────────────────────────────────────
// Demo-grade identity, not an identity provider. The operator is a single named
// human; IBM Bob identifies itself with X-Actor: bob (set by the MCP layer) and
// is tagged with the operator-agent role, which policy.js refuses to let commit.
const { AGENT_ROLE, can, statusFor } = require("./engines/policy");
const auditService = require("./services/audit");

const HUMAN_OPERATOR = { sub: "duty-controller", roles: ["controller", "qa_rp"] };
const BOB_ACTOR = { sub: "bob", roles: [AGENT_ROLE] };

function getActor(req) {
  const header = String(req.get("X-Actor") || "").toLowerCase();
  return header === "bob" ? BOB_ACTOR : HUMAN_OPERATOR;
}

/**
 * Guard a committing action. Refusals are not silent — they are appended to the
 * hash chain, so "the agent tried and was stopped" is evidence a judge can read
 * back out of /api/v1/audit.
 */
function requirePermission(action, entityType) {
  return async (req, res, next) => {
    const actor = getActor(req);
    const verdict = can(actor, action);
    req.actor = actor;
    if (verdict.allowed) return next();
    try {
      await auditService.recordDenial({
        actor,
        action,
        entityType,
        entityId: req.params?.id ?? null,
        reason: verdict.code,
      });
    } catch (_) {
      /* never let audit failure mask the refusal */
    }
    return res.status(statusFor(verdict.code)).json({
      error: verdict.code,
      message: verdict.message,
      action,
      actor: actor.sub,
    });
  };
}

app.get("/api/v1/command-center", requireDb, async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch command center data" });
  }
});

app.get("/api/analytics/temperature", requireDb, async (req, res) => {
  try {
    const logs = await SensorLog.find().sort({ timestamp: 1 });

    // Group logs by hour × shipment → one column per shipment in the chart
    // Result: [{ time: "14:00", "SHIP-MVP-101": 4.2, "SHIP-MVP-102": 5.1, … }, …]
    const hourlyData = {};
    for (const log of logs) {
      const hourStr = new Date(log.timestamp).toISOString().slice(0, 13) + ":00:00Z";
      const timeLabel = new Date(hourStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (!hourlyData[hourStr]) hourlyData[hourStr] = { time: timeLabel };
      const bucket = hourlyData[hourStr];
      const key = log.shipmentId;
      if (!bucket[key]) bucket[key] = { sum: 0, count: 0 };
      bucket[key].sum   += log.temperatureCelsius;
      bucket[key].count += 1;
    }

    const chartData = Object.values(hourlyData).map((bucket) => {
      const row = { time: bucket.time };
      for (const [k, v] of Object.entries(bucket)) {
        if (k === "time") continue;
        row[k] = parseFloat((v.sum / v.count).toFixed(2));
      }
      return row;
    });

    res.json({ data: chartData });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

app.post("/api/disruptions", requireDb, async (req, res) => {
  try {
    const { disruptionType, location } = req.body;

    // ── ONE ACTIVE DISRUPTION AT A TIME ──────────────────────────────────────
    // Resolve any currently active disruptions and wipe their pending recs
    // so the UI always shows a clean single-scenario view.
    const previousActive = await Disruption.find({ status: "Active" });
    if (previousActive.length > 0) {
      await Disruption.updateMany({ status: "Active" }, { $set: { status: "Resolved" } });
      await Recommendation.updateMany({ status: "Pending" }, { $set: { status: "Superseded" } });
      // Reset shipment risk scores to 0 (fresh slate)
      await Shipment.updateMany({}, { $set: { riskScore: 0, riskDrivers: [] } });
      // Notify frontend to clear stale state
      io.emit("scenario.reset", { message: "Previous scenario resolved" });
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
      geometry: { locationName: location, lat, lng, radius: 250 },
      startAt: new Date(),
      status: "Active",
      source: "Manual Entry"
    });

    await newDisruption.save();

    // Trigger async pipeline
    eventBus.emit("disruption.created", newDisruption);

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

app.post("/api/v1/recommendations/:id/approve", requireDb, requirePermission("approve_recommendation", "Recommendation"), async (req, res) => {
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

app.post("/api/v1/recommendations/:id/reject", requireDb, requirePermission("reject_recommendation", "Recommendation"), async (req, res) => {
  try {
    const rec = await Recommendation.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recommendation not found" });

    rec.status = "Rejected";
    await rec.save();

    const user = getMockUser();
    await new AuditEvent({
      actorType: user.actorType, actorId: user.actorId,
      eventType: "RejectRecommendation", entityType: "Recommendation", entityId: rec._id,
      payload: { reason: req.body.reason || "Manually rejected by operator" }
    }).save();

    io.emit("action.completed", { recommendation: rec });
    res.json({ success: true, message: "Action rejected and audit logged." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reset endpoint: wipe all state, re-seed shipments & fleets from DB ────────
app.post("/api/v1/reset", requireDb, async (req, res) => {
  try {
    await Disruption.updateMany({}, { $set: { status: "Resolved" } });
    await Recommendation.updateMany({}, { $set: { status: "Superseded" } });
    await Shipment.updateMany({}, { $set: { riskScore: 0, riskDrivers: [], status: "In Transit" } });
    await FleetAsset.updateMany({}, { $set: { status: "Idle" } });
    io.emit("scenario.reset", { message: "System reset" });
    res.json({ success: true, message: "All scenarios cleared. Ready for fresh simulation." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/audit", requireDb, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const events = await auditService.list(limit);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Walk the whole chain and report the first row where the recomputed hash stops
 * matching. A judge can tamper with one document in Mongo and watch this flip.
 */
app.get("/api/v1/audit/verify", requireDb, async (req, res) => {
  try {
    res.json(await auditService.verify());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Recording endpoint for the Bob PostToolUse hook: every MCP tool call Bob
 * makes lands in the same chain as human actions, attributed to actor "bob".
 */
app.post("/api/v1/audit/bob-call", requireDb, async (req, res) => {
  try {
    const { tool, args, result } = req.body || {};
    if (!tool) return res.status(400).json({ error: "tool is required" });
    const event = await auditService.record({
      actor: BOB_ACTOR,
      action: "mcp_tool_call",
      entityType: "McpTool",
      entityId: String(tool).slice(0, 120),
      outcome: "recorded",
      payload: { tool, args: args ?? null, result: result ?? null },
    });
    res.status(201).json({ seq: event.seq, hash: event.hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/chat", requireDb, async (req, res) => {
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

// ── MCP (SDK Streamable HTTP transport) ─────────────────────────────────────
require("./mcp/mount").mountMcp(app);
// ─────────────────────────────────────────────────────────────────────────────

// ── Health check ─────────────────────────────────────────────────────────────
const startTime = Date.now();
app.get("/health", (req, res) => {
  const { version } = require("./package.json");
  res.status(200).json({
    status: "ok",
    uptimeSec: Math.floor((Date.now() - startTime) / 1000),
    store: getStoreMode(),
    ai: AI_ENABLED() ? "watsonx" : "fallback",
    version,
  });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (req.path === "/mcp") {
    return res.status(400).json({
      jsonrpc: "2.0", id: null,
      error: { code: -32700, message: "Parse error" }
    });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const storeResult = await connectStore();
  if (storeResult.mode !== "none") {
    startSimulation();
  }

  const PORT = Number(process.env.PORT) || 4000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

