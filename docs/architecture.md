# Architecture

## System Architecture

```mermaid
graph TD
    subgraph "Presentation Layer"
        UI[Next.js 16 Dashboard<br/>React 19 + TypeScript]
        MAP[Leaflet Live Map<br/>Disruption Zones + Shipments]
        CHAT[AI Copilot Chat<br/>Floating Widget]
        ANALYTICS[Historical Analytics<br/>Recharts Temperature Chart]
    end

    subgraph "Real-Time Transport"
        WS[Socket.IO WebSocket<br/>temperatureUpdate<br/>telemetry.alert<br/>recommendation.created<br/>action.completed]
    end

    subgraph "API Layer — Node.js Express 5"
        API_CC[GET /api/v1/command-center<br/>KPIs + Alerts + Recommendations]
        API_LOC[GET /api/locations<br/>Shipments + Fleets + Disruptions]
        API_DIS[POST /api/disruptions<br/>Create Disruption Event]
        API_REC[POST /api/v1/recommendations/:id/approve<br/>POST .../reject]
        API_CHAT[POST /api/v1/chat<br/>AI Copilot Query]
        API_TEMP[GET /api/analytics/temperature<br/>Historical Sensor Data]
    end

    subgraph "Event Bus — Node EventEmitter"
        EB_DIS[disruption.created]
        EB_SENS[sensor.reading.received]
    end

    subgraph "Deterministic Engines"
        IE[Impact Engine<br/>Haversine Geospatial<br/>Intersection]
        RE[Risk Engine<br/>6-Factor Weighted<br/>Score 0-100]
        CCE[Cold Chain Engine<br/>Excursion State Machine<br/>Open/Update/Resolve]
        RO[Route Optimizer<br/>Graph-based Candidate<br/>Generation + Ranking]
        FM[Fleet Matcher<br/>5-Factor Compatibility<br/>Scoring]
    end

    subgraph "AI Layer — IBM watsonx.ai"
        WX_EXC[classifyExcursion<br/>GDP Severity Classification<br/>Minor/Major/Critical]
        WX_RER[generateReroutingStrategy<br/>Disruption Response Plan]
        WX_CHAT[processChatQuery<br/>Operations Copilot<br/>with System Context]
    end

    subgraph "Data Layer — MongoDB"
        DB_SHIP[Shipment]
        DB_FLEET[FleetAsset]
        DB_SENS[SensorLog]
        DB_EXC[Excursion]
        DB_ALERT[Alert]
        DB_REC[Recommendation]
        DB_AUDIT[AuditEvent]
        DB_RULE[RuleProfile]
        DB_DIS[Disruption]
        DB_LEG[RouteLeg]
    end

    subgraph "IoT Simulator"
        SIM[5-second Interval<br/>Temperature Generator<br/>25% Spike Probability]
    end

    UI --> API_CC
    UI --> API_LOC
    UI --> API_DIS
    UI --> API_REC
    MAP --> API_LOC
    CHAT --> API_CHAT
    ANALYTICS --> API_TEMP
    UI <-->|WebSocket| WS

    API_DIS --> EB_DIS
    SIM --> EB_SENS

    EB_DIS --> IE
    IE --> RE
    RE --> RO
    RO --> FM
    FM --> DB_REC
    FM --> WX_RER

    EB_SENS --> CCE
    CCE --> DB_EXC
    CCE --> DB_ALERT
    CCE --> WX_EXC

    API_CHAT --> WX_CHAT

    IE --> DB_SHIP
    RE --> DB_SHIP
    CCE --> DB_SENS
    API_REC --> DB_FLEET
    API_REC --> DB_AUDIT

    DB_SHIP --- DB_LEG
    DB_SHIP --- DB_RULE
    DB_SHIP --- DB_SENS
```

## Components

| Component | Technology | Responsibility |
|---|---|---|
| Frontend Dashboard | Next.js 16 + React 19 + TypeScript | Main operator UI, KPI cards, action center, alerts feed, sensor feed |
| Live Map | React-Leaflet + Leaflet | Geospatial view of shipments, idle fleets, disruption zones |
| AI Chat Widget | React + Socket.IO client | Floating copilot chat with streaming typing indicator |
| Historical Analytics | Recharts | Hourly average temperature line chart from seeded sensor logs |
| Backend API | Node.js + Express 5 | REST API + Socket.IO server + internal event bus |
| Impact Engine | `engines/impactEngine.js` | Haversine geospatial intersection — disruption radius vs shipment route legs |
| Risk Engine | `engines/riskEngine.js` | 6-factor weighted risk score (0–100) with named driver explanations |
| Cold Chain Engine | `engines/coldChainEngine.js` | Deterministic excursion state machine: Open/Update/Resolve |
| Route Optimizer | `engines/routeOptimizer.js` | Graph-based candidate route generation ranked by cost/time/risk |
| Fleet Matcher | `engines/fleetMatcher.js` | 5-factor idle asset compatibility scoring with hard cold-chain filter |
| AI Service | `aiService.js` + watsonx.ai SDK | Three watsonx.ai call types: excursion classify, rerouting strategy, chat |
| IoT Simulator | `server.js startSimulation()` | 5-second interval mock sensor readings with 25% spike probability |
| MongoDB | Mongoose ODM | 10 domain entity schemas with full relational references |

## Data Flow

### Disruption Event Flow
1. Operator clicks "LA Port Strike" on dashboard → `POST /api/disruptions`
2. Disruption document created in MongoDB; `disruption.created` event emitted on internal bus
3. Impact Engine fetches all `In Transit` shipments, runs Haversine intersection vs disruption geometry
4. Impacted shipments: Risk Engine computes 6-factor score; shipment riskScore updated in DB
5. Route Optimizer generates ranked alternatives; Fleet Matcher scores idle reefer trucks
6. Recommendation document saved; `recommendation.created` Socket.IO event pushes to all connected UIs
7. UI Action Center updates live; operator sees recommendation with rationale

### Cold-Chain Telemetry Flow
1. Simulator fires every 5 seconds; 25% chance of temperature spike (>8°C)
2. SensorLog saved to MongoDB; `sensor.reading.received` event emitted
3. Cold Chain Engine loads shipment's RuleProfile; evaluates temperature against min/max/warningBand
4. If excursion detected: Excursion document opened; Alert created; `telemetry.alert` Socket.IO event fired
5. watsonx.ai called with shipment ID + temperature → GDP severity classification + disposition instruction
6. If reading returns to safe range: Excursion resolved; `excursion.resolved` event emitted

### Action Approval Flow
1. Operator clicks "Approve & Execute" on recommendation
2. `POST /api/v1/recommendations/:id/approve` → Recommendation status = "Approved"
3. Fleet asset status updated to "In Transit" in MongoDB
4. AuditEvent created with actor, action type, entity reference, and timestamp
5. `action.completed` Socket.IO event removes recommendation from all connected UIs

## Security Considerations

- API keys (`WATSONX_API_KEY`, `WATSONX_PROJECT_ID`) stored in environment variables, never committed to git
- `.env` is in `.gitignore`; `.env.example` provides template with dummy values
- CORS configured on backend; Socket.IO allows all origins for demo purposes
- watsonx.ai model prompts treat retrieved data as untrusted and explicitly instruct the model not to fabricate facts

## Scalability Notes

For a production system:
- Replace Node.js `EventEmitter` with Redis + BullMQ for durable, distributed event processing
- Replace local MongoDB with a managed instance (IBM Cloudant, MongoDB Atlas)
- Add PostGIS to the data layer for production-grade geospatial route intersection
- The frontend is stateless and can be horizontally scaled behind a CDN
- Each engine (Impact, Risk, Cold Chain) can be extracted as a separate worker process
