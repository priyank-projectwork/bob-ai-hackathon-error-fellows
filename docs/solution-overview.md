# Solution Overview

## What We Built

SupplyChain AI Copilot is a real-time supply chain control tower purpose-built for cold-chain pharmaceutical logistics. It continuously correlates three live data streams — disruption events, IoT sensor telemetry, and fleet availability — and uses a layered architecture that separates deterministic operational calculation from generative AI explanation.

The core design principle: **AI recommends and explains; deterministic engines calculate the facts.**

## How It Works

The system operates on a continuous **Detect → Assess → Optimise → Act** loop:

1. **Detect** — An operations manager triggers a disruption scenario (Port Strike, Blizzard, Hurricane) via the dashboard, or a simulated IoT sensor reading arrives via the 5-second polling loop.

2. **Assess — Disruption Path:**
   - The **Impact Engine** runs Haversine geospatial intersection between the disruption's radius and every active shipment's route legs.
   - The **Risk Engine** computes a 0–100 risk score using 6 weighted factors: disruption exposure, deadline proximity, cargo criticality, cold-chain risk, financial exposure, and route dependency. Named risk drivers are shown to the operator.

3. **Assess — Cold-Chain Path:**
   - Every sensor reading is validated against the shipment's **Rule Profile** (Vaccine: 2°C–8°C).
   - The **Cold Chain Engine** (deterministic state machine) opens, updates, or resolves an excursion incident based on temperature magnitude and duration thresholds.
   - **watsonx.ai** (Llama 4 Maverick) classifies the excursion against GDP guidelines and generates a regulatory-grounded disposition recommendation.

4. **Optimise:**
   - The **Route Optimizer** generates ranked alternative routes that avoid the disruption zone, scored by cost delta, time delta, and residual risk.
   - The **Fleet Matcher** scores idle reefer trucks for compatibility with impacted shipments using 5 factors: proximity, capacity fit, cold-chain capability, availability, and deadhead distance.
   - A structured **Recommendation** is created combining the best route alternative and the best fleet match.

5. **Act:**
   - The AI Action Center surfaces the top recommendations with full rationale.
   - The operator approves or rejects. Approval updates fleet status and creates an immutable **AuditEvent**.
   - Real-time updates propagate to all connected dashboards via Socket.IO WebSockets.

6. **Explain (AI Copilot):**
   - The floating AI Operations Copilot accepts natural-language questions ("What shipments are at risk?", "Why is this recommendation made?").
   - watsonx.ai receives the full live system context (active shipments, disruptions, idle fleets) and returns a grounded, concise answer.

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Deterministic engines before LLM | Numerical risk scores, fleet matching, and excursion severity must be reproducible and auditable. LLMs cannot be trusted for precise calculations. |
| Event-driven internal bus | Disruption and sensor events trigger asynchronous impact analysis, preventing long-running work from blocking API requests. |
| watsonx.ai as explainer, not oracle | The model receives *structured tool results* and explains them in natural language. It does not invent operational facts. |
| Versioned Rule Profiles | Cold-chain thresholds (minTempC, maxTempC, warningBand, durationRules) are stored as configurable MongoDB documents, making severity decisions reproducible and auditable. |
| Human-in-the-loop approval | High-impact actions (reroute, fleet reassignment) require explicit operator approval before execution, consistent with operational safety requirements. |
| Socket.IO for real-time UX | The demo must *feel* live. WebSocket events propagate disruption impacts, temperature alerts, new recommendations, and action completions to all connected clients instantly. |

## IBM Technologies Used

- **watsonx.ai (meta-llama/llama-4-maverick-17b-128e-instruct-fp8):** Used in three distinct modes:
  1. **Cold-chain excursion classification** — Given temperature, shipment ID, and the GDP severity bands, the model outputs structured `{severity, recommendedAction}` JSON with a resilient hybrid parser (JSON.parse → regex → grounded fallback) to handle production LLM output variability.
  2. **Disruption rerouting strategy** — Given disruption type, location, affected shipment count, and idle fleet assets, the model proposes a `{recommendedAction, reassignedAssets, alternateRoute}` response.
  3. **Operations Copilot** — Given the user's natural-language question and the full live system context (JSON serialised active shipments, disruptions, idle fleets), the model returns a concise, grounded operational answer.

- **IBM Bob:** Used as the AI coding agent throughout the development of this submission, including codebase exploration, architecture review, feature implementation, and documentation generation.

## User Experience

The operator sees a single-page dashboard with:
- **4 KPI cards** (active disruptions, idle fleet assets, critical shipments, cold-chain alerts)
- **Live Leaflet map** with shipment positions, idle fleet markers, and disruption zones rendered as circles
- **AI Action Center** with pending recommendations that can be approved with one click
- **Active Incidents feed** showing cold-chain and disruption alerts with severity colour coding
- **Live Sensor Feed** showing the last 15 temperature readings in real time
- **Historical Analytics** (Recharts line chart) showing hourly average temperature over the past 24 hours
- **Floating AI Chat Copilot** for natural-language operational Q&A
