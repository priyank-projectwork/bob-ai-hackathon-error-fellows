# SupplyChain AI Copilot — IBM Bob MCP Server

This MCP (Model Context Protocol) server connects **IBM Bob** directly to the SupplyChain AI Copilot's live operational data. When you ask Bob a question about supply chain state, Bob calls these tools to retrieve structured facts — it never fabricates numbers.

## How It Works

```
You ask Bob: "What shipments are at risk?"
    ↓
Bob calls: get_affected_shipments()
    ↓
Tool queries: GET http://127.0.0.1:4000/api/locations
    ↓
Returns structured JSON: [{shipmentId, riskScore, riskBand, riskDrivers, ...}]
    ↓
Bob reasons over real data and responds:
"3 shipments are in transit. SHIP-MVP-101 is CRITICAL (score 87) due to:
 High disruption exposure + Active temperature excursion + Critical priority cargo.
 It arrives in 3.8 hours — intervention window: 2.8 hours remaining."
```

## 6 Registered Tools

| Tool | What it returns | When Bob calls it |
|---|---|---|
| `get_active_disruptions` | All live disruptions with type, location, severity | "What disruptions are active?" |
| `get_affected_shipments` | All shipments sorted by risk score + risk drivers | "What shipments are affected?" / "What's at risk?" |
| `get_shipment_risk` | 6-factor risk breakdown for a specific shipment | "Why is SHIP-MVP-101 critical?" |
| `get_cold_chain_status` | Open excursions with GDP severity and details | "Any temperature issues?" / "Cold chain status?" |
| `get_idle_fleet_assets` | Available reefer trucks with location and capacity | "What assets can I redeploy?" |
| `get_action_center` | Pending recommendations with full evidence | "What should I do?" / "What actions are pending?" |

## Setup

The server is registered in `.bob/mcp.json`. It starts automatically when Bob loads.

**Prerequisite:** The ColdChain backend must be running on `http://127.0.0.1:4000`.

To start the backend:
```bash
cd src/backend
npm start
```

Then ask Bob:
- `"What shipments are currently at risk?"`
- `"Is there an active disruption? Which shipments does it affect?"`  
- `"What's the cold chain status right now?"`
- `"What should I do about SHIP-MVP-101?"`
- `"Are there idle reefer trucks near Chicago?"`
- `"What actions are pending in the Action Center?"`

## Build

```bash
cd src/mcp-server
npm install
npm run build
```

The compiled server is at `src/mcp-server/build/index.js`.

## Architecture Principle

> **AI recommends and explains; deterministic engines calculate the facts.**

Every number Bob shows you — risk scores, excursion severity, fleet match scores — comes from a deterministic engine in `src/backend/engines/`. The MCP tools are the bridge that brings those structured results into Bob's context so it can explain them, not invent them.
