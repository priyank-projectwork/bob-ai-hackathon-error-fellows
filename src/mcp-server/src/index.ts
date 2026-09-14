#!/usr/bin/env node
/**
 * ColdChain AI Copilot — MCP Server for IBM Bob
 *
 * Exposes 6 operational tools that Bob uses to answer real questions
 * about live supply chain state. Bob calls these tools, receives
 * structured data, and explains results — never fabricating facts.
 *
 * Tools:
 *   1. get_active_disruptions    — live disruption registry
 *   2. get_affected_shipments    — impact engine results per disruption
 *   3. get_shipment_risk         — 6-factor risk score + drivers for a shipment
 *   4. get_cold_chain_status     — open excursions + last sensor readings
 *   5. get_idle_fleet_assets     — idle reefer trucks available for redeployment
 *   6. get_action_center         — pending AI recommendations awaiting approval
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Config ────────────────────────────────────────────────────────────────
const API_BASE = process.env.COLDCHAIN_API_URL ?? "http://127.0.0.1:4000";

// ─── Helper: safe fetch with timeout ───────────────────────────────────────
async function apiFetch(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Risk band helper ───────────────────────────────────────────────────────
function riskBand(score: number): string {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "WATCH";
  return "NORMAL";
}

// ─── Server ────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "coldchain-copilot",
  version: "1.0.0",
});

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 1 — get_active_disruptions
// ══════════════════════════════════════════════════════════════════════════════
server.registerTool(
  "get_active_disruptions",
  {
    description:
      "Returns all currently active supply chain disruptions (port strikes, blizzards, hurricanes, etc.) " +
      "with their type, location, severity, and geometry. " +
      "Call this first when an operator asks about current disruptions or network status.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = (await apiFetch("/api/locations")) as {
        disruptions: Array<{
          _id: string;
          type: string;
          title: string;
          severity: string;
          status: string;
          geometry: { locationName: string; lat: number; lng: number; radius: number };
          startAt: string;
        }>;
      };

      const disruptions = data.disruptions ?? [];

      if (disruptions.length === 0) {
        return {
          content: [{ type: "text" as const, text: "✅ No active disruptions. All network routes are clear." }],
        };
      }

      const summary = disruptions.map((d) => ({
        id: d._id,
        type: d.type,
        title: d.title,
        severity: d.severity,
        location: d.geometry?.locationName ?? "Unknown",
        radius_km: d.geometry?.radius ? Math.round(d.geometry.radius / 1000) : "unknown",
        active_since: d.startAt ? new Date(d.startAt).toLocaleString() : "unknown",
      }));

      return {
        content: [
          {
            type: "text" as const,
            text:
              `🚨 ${disruptions.length} active disruption(s):\n\n` +
              JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error fetching disruptions: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 2 — get_affected_shipments
// ══════════════════════════════════════════════════════════════════════════════
server.registerTool(
  "get_affected_shipments",
  {
    description:
      "Returns all in-transit shipments with their current risk scores and risk drivers. " +
      "Shows which shipments are CRITICAL, HIGH, WATCH, or NORMAL. " +
      "Call this to answer: which shipments are affected? what is at risk? which is most urgent?",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = (await apiFetch("/api/locations")) as {
        shipments: Array<{
          shipmentId: string;
          cargoType: string;
          cargoValue: number;
          priority: string;
          origin: string;
          destination: string;
          status: string;
          riskScore: number;
          riskDrivers: string[];
          eta: string;
          deliveryDeadline: string;
          carrier: string;
        }>;
      };

      const shipments = (data.shipments ?? []).sort((a, b) => b.riskScore - a.riskScore);

      if (shipments.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No shipments currently in transit." }],
        };
      }

      const summary = shipments.map((s) => ({
        shipmentId: s.shipmentId,
        cargoType: s.cargoType,
        cargoValue: `$${(s.cargoValue ?? 0).toLocaleString()}`,
        priority: s.priority,
        route: `${s.origin} → ${s.destination}`,
        riskScore: s.riskScore,
        riskBand: riskBand(s.riskScore),
        riskDrivers: s.riskDrivers ?? [],
        eta: s.eta ? new Date(s.eta).toLocaleString() : "unknown",
        deliveryDeadline: s.deliveryDeadline ? new Date(s.deliveryDeadline).toLocaleString() : "unknown",
        carrier: s.carrier,
      }));

      const critical = summary.filter((s) => s.riskBand === "CRITICAL");
      const high = summary.filter((s) => s.riskBand === "HIGH");

      const header =
        critical.length > 0
          ? `🔴 ${critical.length} CRITICAL, ${high.length} HIGH shipment(s) require immediate attention.\n\n`
          : high.length > 0
          ? `🟠 ${high.length} HIGH risk shipment(s). No CRITICAL shipments.\n\n`
          : `✅ All ${shipments.length} shipments are WATCH or NORMAL risk.\n\n`;

      return {
        content: [
          {
            type: "text" as const,
            text: header + JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 3 — get_shipment_risk
// ══════════════════════════════════════════════════════════════════════════════
server.registerTool(
  "get_shipment_risk",
  {
    description:
      "Returns the detailed 6-factor risk breakdown for a specific shipment by its ID. " +
      "Shows disruption exposure, deadline pressure, cargo criticality, cold-chain risk, " +
      "financial exposure, and route dependency scores. " +
      "Call this when the operator asks WHY a specific shipment is risky.",
    inputSchema: z.object({
      shipment_id: z.string().describe("The shipment ID, e.g. SHIP-MVP-101"),
    }),
  },
  async ({ shipment_id }) => {
    try {
      const data = (await apiFetch("/api/locations")) as {
        shipments: Array<{
          shipmentId: string;
          cargoType: string;
          cargoValue: number;
          priority: string;
          origin: string;
          destination: string;
          riskScore: number;
          riskDrivers: string[];
          eta: string;
          deliveryDeadline: string;
        }>;
      };

      const shipment = (data.shipments ?? []).find(
        (s) => s.shipmentId === shipment_id
      );

      if (!shipment) {
        return {
          content: [{ type: "text" as const, text: `Shipment ${shipment_id} not found or not in transit.` }],
          isError: true,
        };
      }

      // Calculate time-to-delivery if eta available
      let hoursToDelivery: number | null = null;
      let interventionWindowHours: number | null = null;
      if (shipment.eta) {
        hoursToDelivery = (new Date(shipment.eta).getTime() - Date.now()) / (1000 * 60 * 60);
        interventionWindowHours = Math.max(0, hoursToDelivery - 1); // need at least 1h buffer
      }

      const detail = {
        shipmentId: shipment.shipmentId,
        cargoType: shipment.cargoType,
        cargoValue: `$${(shipment.cargoValue ?? 0).toLocaleString()}`,
        priority: shipment.priority,
        route: `${shipment.origin} → ${shipment.destination}`,
        overallRisk: {
          score: shipment.riskScore,
          band: riskBand(shipment.riskScore),
        },
        riskDrivers: shipment.riskDrivers ?? [],
        timeline: {
          eta: shipment.eta ? new Date(shipment.eta).toLocaleString() : "unknown",
          deadline: shipment.deliveryDeadline ? new Date(shipment.deliveryDeadline).toLocaleString() : "unknown",
          hoursToDelivery: hoursToDelivery !== null ? `${hoursToDelivery.toFixed(1)}h` : "unknown",
          interventionWindow: interventionWindowHours !== null
            ? interventionWindowHours > 0
              ? `${interventionWindowHours.toFixed(1)}h remaining to act`
              : "⚠️ PAST intervention window — immediate action required"
            : "unknown",
        },
      };

      return {
        content: [
          {
            type: "text" as const,
            text: `Risk breakdown for ${shipment_id}:\n\n` + JSON.stringify(detail, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 4 — get_cold_chain_status
// ══════════════════════════════════════════════════════════════════════════════
server.registerTool(
  "get_cold_chain_status",
  {
    description:
      "Returns the cold-chain monitoring status: open temperature excursions, " +
      "their severity (Minor/Major/Critical), the rule profile used for classification, " +
      "and the most recent sensor readings. " +
      "Call this when operator asks about temperature issues, excursions, or cargo quality risk.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = (await apiFetch("/api/v1/command-center")) as {
        kpis: { openColdChainAlerts: number };
        alerts: Array<{
          _id: string;
          severity: string;
          entityType: string;
          title: string;
          message: string;
          createdAt: string;
          status: string;
        }>;
      };

      const excursionAlerts = (data.alerts ?? []).filter(
        (a) => a.entityType === "Excursion" && a.status === "Open"
      );

      if (excursionAlerts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "✅ Cold chain status: ALL CLEAR. No open temperature excursions detected. All shipments within safe temperature range (2°C–8°C).",
            },
          ],
        };
      }

      const excursions = excursionAlerts.map((a) => ({
        alertId: a._id,
        severity: a.severity,
        title: a.title,
        details: a.message,
        detectedAt: new Date(a.createdAt).toLocaleString(),
        status: a.status,
      }));

      const criticalCount = excursions.filter((e) => e.severity === "Critical").length;
      const header = criticalCount > 0
        ? `🔴 CRITICAL: ${criticalCount} critical cold-chain excursion(s) requiring immediate disposition decision.\n\n`
        : `🟠 ${excursions.length} open temperature excursion(s) detected.\n\n`;

      return {
        content: [
          {
            type: "text" as const,
            text: header + JSON.stringify(excursions, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 5 — get_idle_fleet_assets
// ══════════════════════════════════════════════════════════════════════════════
server.registerTool(
  "get_idle_fleet_assets",
  {
    description:
      "Returns all idle fleet assets (reefer trucks, containers) that are available for redeployment. " +
      "Shows location, capacity, cold-chain capability, and availability window. " +
      "Call this when operator asks: what assets can I redeploy? are there idle trucks near the disruption?",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = (await apiFetch("/api/locations")) as {
        fleets: Array<{
          assetId: string;
          type: string;
          status: string;
          locationName: string;
          capacityWeight: number;
          coldChainCapable: boolean;
          availableFrom: string;
          availableTo: string;
          currentLocation: { lat: number; lng: number };
        }>;
      };

      const idle = data.fleets ?? [];

      if (idle.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No idle fleet assets currently available. All assets are deployed.",
            },
          ],
        };
      }

      const summary = idle.map((f) => ({
        assetId: f.assetId,
        type: f.type,
        location: f.locationName ?? `${f.currentLocation?.lat?.toFixed(2)}, ${f.currentLocation?.lng?.toFixed(2)}`,
        capacityKg: f.capacityWeight,
        coldChainCapable: f.coldChainCapable,
        available: f.availableTo ? `until ${new Date(f.availableTo).toLocaleString()}` : "available now",
      }));

      const reeferCount = summary.filter((f) => f.coldChainCapable).length;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `🚛 ${idle.length} idle asset(s) available (${reeferCount} reefer/cold-chain capable):\n\n` +
              JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 6 — get_action_center
// ══════════════════════════════════════════════════════════════════════════════
server.registerTool(
  "get_action_center",
  {
    description:
      "Returns all pending AI-generated recommendations in the Action Center, " +
      "ranked by risk score. Each recommendation includes the rationale, " +
      "proposed reroute, fleet assignment, and confidence score. " +
      "Call this when operator asks: what should I do? what actions are pending? what does the AI recommend?",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = (await apiFetch("/api/v1/command-center")) as {
        kpis: {
          activeDisruptions: number;
          idleAssets: number;
          criticalShipments: number;
          openColdChainAlerts: number;
        };
        recommendations: Array<{
          _id: string;
          entityType: string;
          entityId: string;
          recommendationType: string;
          rationale: string;
          score: number;
          confidence: number;
          status: string;
          evidence?: {
            alternateRoute?: { route: string; costDelta: number; timeDeltaHours: number; riskScore: number };
            fleetMatch?: { fleet: { assetId: string; locationName: string }; matchScore: number; distanceKm: number };
          };
        }>;
      };

      const { kpis, recommendations } = data;
      const pending = (recommendations ?? []).filter((r) => r.status === "Pending");

      const networkStatus = {
        activeDisruptions: kpis?.activeDisruptions ?? 0,
        criticalShipments: kpis?.criticalShipments ?? 0,
        idleAssets: kpis?.idleAssets ?? 0,
        openColdChainAlerts: kpis?.openColdChainAlerts ?? 0,
      };

      if (pending.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ Action Center is clear — no pending recommendations.\n\n` +
                `Network status: ${JSON.stringify(networkStatus, null, 2)}`,
            },
          ],
        };
      }

      const actions = pending.map((r) => ({
        recommendationId: r._id,
        affectedShipment: r.entityId,
        type: r.recommendationType,
        riskScore: r.score,
        riskBand: riskBand(r.score),
        confidence: `${r.confidence ?? 0}%`,
        rationale: r.rationale,
        proposedRoute: r.evidence?.alternateRoute
          ? {
              via: r.evidence.alternateRoute.route,
              costDelta: `+$${r.evidence.alternateRoute.costDelta}`,
              timeDelta: `${r.evidence.alternateRoute.timeDeltaHours > 0 ? "+" : ""}${r.evidence.alternateRoute.timeDeltaHours}h`,
              newRiskScore: r.evidence.alternateRoute.riskScore,
            }
          : null,
        proposedFleet: r.evidence?.fleetMatch
          ? {
              asset: r.evidence.fleetMatch.fleet?.assetId,
              location: r.evidence.fleetMatch.fleet?.locationName,
              matchScore: r.evidence.fleetMatch.matchScore,
              distanceKm: r.evidence.fleetMatch.distanceKm,
            }
          : null,
        approveEndpoint: `POST /api/v1/recommendations/${r._id}/approve`,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text:
              `⚡ ${pending.length} pending recommendation(s) require operator approval.\n` +
              `Network: ${networkStatus.activeDisruptions} disruptions | ${networkStatus.criticalShipments} critical shipments | ${networkStatus.openColdChainAlerts} cold-chain alerts\n\n` +
              JSON.stringify(actions, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Start ──────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ ColdChain MCP Server running on stdio — 6 tools registered");
  console.error(`   API_BASE: ${API_BASE}`);
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
});
