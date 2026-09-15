# 🚀 SupplyChain AI Copilot

> **Supply Chain Disruption Assistant & Fleet Utilisation Optimizer**  
> IBM Bob AI Hackathon 2026 — Team **Error Fellows** — Track **AI**

---

## 👥 Team

| Field | Value |
|---|---|
| **Team Name** | Error Fellows |
| **Track** | AI |
| **Team Lead** | Nilkanth Patel — 25msit125@charusat.edu.in |
| **Members** | Manav Shah — 25mca154@charusat.edu.in |
| | Priyank Patel — 25mca120@charusat.edu.in |
| | Prachi Patel — 25mca119@charusat.edu.in |

---

## 🎯 Problem Statement

Supply chain operations teams managing cold-chain pharmaceutical shipments (vaccines, biologics) face a dual crisis: disruptions such as port strikes, blizzards, and hurricanes cascade across hundreds of active shipments in ways that are impossible to track manually, while IoT temperature sensors generate thousands of readings per day that go unanalysed until a $500K+ cargo arrives spoiled at its destination. The combination means operations managers are always reacting too late — after the damage is done.

---

## 💡 Solution

SupplyChain AI Copilot is a real-time supply chain control tower that continuously correlates live IoT sensor telemetry, active disruption events, shipment routes, and fleet availability using deterministic engines for risk scoring, route optimisation, and cold-chain excursion detection. An IBM watsonx.ai-powered AI Operations Copilot (Llama 4 Maverick) overlays structured results with natural-language explanations, ranked recommendations, and human-in-the-loop approval workflows — so operators can detect, triage, and act on disruptions before cargo is compromised.

---

## ✨ Key Features

- **Real-time Cold-Chain Excursion Detection:** IoT temperature readings evaluated every 5 seconds against GDP-compliant rule profiles. Excursion severity (Minor/Major/Critical) is classified by watsonx.ai with regulatory-grounded rationale.
- **Event-Driven Disruption Impact Engine:** Port strikes, blizzards, and hurricanes are mapped to affected shipments using Haversine geospatial intersection of shipment route legs against disruption geometry.
- **Deterministic 6-Factor Risk Scoring:** Every shipment gets a transparent risk score (0–100) from disruption exposure, deadline proximity, cargo criticality, cold-chain risk, financial exposure, and route dependency — with named drivers shown to operators.
- **AI Route Optimiser & Fleet Matcher:** Alternatives are ranked by cost/time/risk; idle reefer trucks are scored for compatibility and matched to impacted cold-chain shipments.
- **AI Operations Copilot with Audit Trail:** Floating chat interface powered by watsonx.ai answers natural-language operational questions with live system context. Every approve/reject action generates an immutable audit event.

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | JavaScript (Node.js backend), TypeScript (Next.js frontend) |
| **Frameworks** | Next.js 16, React 19, Express 5, Socket.IO, Mongoose, Tailwind CSS 4, Recharts, React Leaflet |
| **IBM Technologies** | watsonx.ai (meta-llama/llama-4-maverick-17b-128e-instruct-fp8), @ibm-cloud/watsonx-ai SDK, IBM Bob |
| **Databases** | MongoDB 7 (via Mongoose ODM) |
| **Other** | Node.js 20, WebSockets, Leaflet geospatial maps |

---

## 📁 Repository Structure

```
src/
├── backend/
│   ├── server.js           # Express API + Socket.IO + event bus
│   ├── aiService.js        # watsonx.ai integration (excursion, rerouting, chat)
│   ├── seed.js             # MongoDB seed script
│   ├── engines/
│   │   ├── impactEngine.js     # Geospatial disruption → shipment impact
│   │   ├── riskEngine.js       # 6-factor deterministic risk scoring
│   │   ├── coldChainEngine.js  # Excursion state machine
│   │   ├── routeOptimizer.js   # Route alternatives ranking
│   │   └── fleetMatcher.js     # Idle asset matching
│   └── models/             # Mongoose schemas (10 domain entities)
└── frontend/
    ├── app/page.tsx         # Main dashboard
    └── components/
        ├── ChatCopilot.tsx         # AI floating chat
        ├── LiveMap.tsx             # Leaflet geospatial map
        └── HistoricalAnalytics.tsx # Recharts temperature history
docs/
├── problem-statement.md
├── solution-overview.md
├── architecture.md
└── setup-guide.md
demo/
├── demo-video-link.txt
└── screenshots/
```

---

## ⚡ How to Run

See [`docs/setup-guide.md`](docs/setup-guide.md) for full instructions.

```bash
# Prerequisites: Node.js 20+, MongoDB 7 running on port 27017

# 1. Clone the repo
git clone https://github.com/nilkanth-patel/bob-ai-hackathon-error-fellows.git
cd bob-ai-hackathon-error-fellows

# 2. Configure environment
cp src/.env.example src/backend/.env
# Edit src/backend/.env — add WATSONX_API_KEY, WATSONX_PROJECT_ID

# 3. Install & seed backend
cd src/backend
npm install
npm run seed

# 4. Start backend (new terminal)
npm start

# 5. Install & start frontend (new terminal)
cd ../frontend
npm install
npm run dev
```

The dashboard is available at **http://localhost:3000**

---

## 🖥️ Demo

| Artifact | Link |
|---|---|
| 📹 Demo Video | [Watch on Loom](https://www.loom.com/share/c66d6b32418b463188f9eecb238a756d) |
| 🌐 Live Demo | NOT DEPLOYED — see video |
| 🖼️ Screenshots | [See demo/screenshots/](demo/screenshots/) |
| 📊 Presentation | [See presentation/](presentation/) |

---

## ⚠️ Known Limitations

- Authentication is mocked — single hardcoded Operations Manager role, not production-ready
- MongoDB runs locally — no cloud deployment for this submission
- Route graph is a demo network (5 US hubs); production would integrate a live routing engine
- IoT sensor stream is simulated at 5-second intervals; production would use an MQTT gateway
- Demo video shows local execution only

---

## 🏅 What We're Most Proud Of

The strict separation between deterministic computation and generative AI is the core architectural achievement. Every numerical fact shown to operators — risk scores (6-factor weighted model), excursion severity, route costs, fleet match scores — is produced by a deterministic, testable engine. watsonx.ai is used exclusively as an explainer and orchestrator: it classifies cold-chain severity against GDP guidelines, generates rationale for recommendations, and answers natural-language queries grounded in live system state. This means the system is **correct-by-design**, not hallucination-dependent — exactly the production-grade pattern described in the architecture specification as "the differentiator."
