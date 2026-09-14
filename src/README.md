# Source Code — ColdChain AI Copilot

This directory contains all source code for the ColdChain AI Copilot submission.

## Layout

```
src/
├── .env.example          ← Environment variable template (copy to backend/.env)
├── README.md             ← This file
├── backend/              ← Node.js Express API + AI service + domain engines
│   ├── server.js         ← Main server: Express routes, Socket.IO, event bus, IoT simulator
│   ├── aiService.js      ← IBM watsonx.ai integration (3 call types)
│   ├── seed.js           ← MongoDB seed script (run once before first start)
│   ├── package.json      ← Backend dependencies
│   ├── engines/
│   │   ├── impactEngine.js     ← Haversine geospatial disruption impact calculation
│   │   ├── riskEngine.js       ← 6-factor deterministic risk scoring (0-100)
│   │   ├── coldChainEngine.js  ← Temperature excursion state machine
│   │   ├── routeOptimizer.js   ← Route alternative generation and ranking
│   │   └── fleetMatcher.js     ← Idle asset compatibility scoring
│   └── models/
│       ├── Shipment.js         ← Shipment master + current state
│       ├── FleetAsset.js       ← Truck/container with cold-chain capability
│       ├── SensorLog.js        ← Raw IoT temperature/humidity readings
│       ├── Excursion.js        ← Derived temperature excursion incidents
│       ├── Alert.js            ← Notification records
│       ├── Recommendation.js   ← AI-generated action recommendations
│       ├── AuditEvent.js       ← Immutable action audit trail
│       ├── Disruption.js       ← Active disruption events with geometry
│       ├── RouteLeg.js         ← Ordered shipment journey segments
│       └── RuleProfile.js      ← Versioned cold-chain threshold rules
└── frontend/             ← Next.js 16 + React 19 + TypeScript operator UI
    ├── app/
    │   ├── page.tsx      ← Main dashboard: KPIs, alerts, action center, sensor feed
    │   ├── layout.tsx    ← Root layout
    │   └── globals.css   ← Tailwind CSS base
    ├── components/
    │   ├── ChatCopilot.tsx         ← Floating AI chat widget (watsonx.ai)
    │   ├── LiveMap.tsx             ← Leaflet geospatial map component
    │   └── HistoricalAnalytics.tsx ← Recharts temperature history chart
    └── package.json      ← Frontend dependencies
```

## Quick Start

See [`../docs/setup-guide.md`](../docs/setup-guide.md) for the complete setup guide.

```bash
# 1. Configure environment
cp .env.example backend/.env
# Edit backend/.env with your WATSONX_API_KEY and WATSONX_PROJECT_ID

# 2. Backend
cd backend && npm install && npm run seed && npm start

# 3. Frontend (new terminal)
cd frontend && npm install && npm run dev
```
