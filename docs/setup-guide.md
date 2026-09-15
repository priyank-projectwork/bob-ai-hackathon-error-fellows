# Setup Guide

> **This guide has been tested end-to-end. Follow every step exactly.**

## Prerequisites

Before you begin, ensure you have the following installed:

- [ ] **Node.js 20+** — [nodejs.org/download](https://nodejs.org/download)
- [ ] **MongoDB 7 Community** — [mongodb.com/try/download/community](https://www.mongodb.com/try/download/community)
- [ ] **An IBM Cloud account** with watsonx.ai access — [cloud.ibm.com](https://cloud.ibm.com)
- [ ] **Git** — [git-scm.com](https://git-scm.com)

Verify Node.js and MongoDB are running:
```bash
node --version      # should print v20.x.x or higher
mongosh --version   # should connect to local MongoDB
```

## IBM watsonx.ai Credentials

You need three values from your IBM Cloud account:

| Variable | Where to find it |
|---|---|
| `WATSONX_API_KEY` | IBM Cloud → Manage → Access (IAM) → API keys → Create |
| `WATSONX_PROJECT_ID` | watsonx.ai → Your Project → Manage → Project ID |
| `WATSONX_URL` | Regional endpoint, e.g. `https://us-south.ml.cloud.ibm.com` |

## Environment Variables

```bash
# From the repo root:
cp src/.env.example src/backend/.env
```

Then edit `src/backend/.env` and fill in:

```env
WATSONX_API_KEY=your_actual_api_key
WATSONX_PROJECT_ID=your_actual_project_id
WATSONX_URL=https://us-south.ml.cloud.ibm.com
MONGO_URI=mongodb://127.0.0.1:27017/bob-logistics-hackathon
```

> **Note:** The app works without valid watsonx credentials — all AI calls have grounded fallback responses. The deterministic engines (risk scoring, fleet matching, route optimization) run independently of the AI layer.

## Installation

### Step 1 — Clone the repository

```bash
git clone https://github.com/nilkanth-patel/bob-ai-hackathon-error-fellows.git
cd bob-ai-hackathon-error-fellows
```

### Step 2 — Configure environment

```bash
cp src/.env.example src/backend/.env
# Edit src/backend/.env with your watsonx.ai credentials (see above)
```

### Step 3 — Install backend dependencies

```bash
cd src/backend
npm install
```

### Step 4 — Seed the database

This creates 5 vaccine shipments, 5 idle reefer trucks, a vaccine rule profile, and 24 hours of historical sensor logs.

```bash
npm run seed
# Expected output:
# ✅ MongoDB connected for seeding
# ✅ Seeded 5 Shipments and Route Legs
# ✅ Seeded 5 FleetAssets
# ✅ Seeded 24 hours of Historical Sensor Logs
# ✅ Seeding complete, connection closed
```

### Step 5 — Install frontend dependencies

```bash
cd ../frontend
npm install
```

## Running the Application

You need **two terminal windows**.

**Terminal 1 — Backend:**
```bash
cd src/backend
npm start
# Expected output:
# ✅ MongoDB connected
# 🌡️ Starting mock IoT temperature stream (every 5s)...
# 🚀 Server running on http://127.0.0.1:4000
```

**Terminal 2 — Frontend:**
```bash
cd src/frontend
npm run dev
# Expected output:
# ▲ Next.js 16.x.x
# - Local: http://localhost:3000
```

Open **http://localhost:3000** in your browser.

## Verifying It Works

1. **Dashboard loads** — You see 4 KPI cards. "Idle Fleet Assets" should show **5**.
2. **Live Connection badge** — Top right shows a green pulsing dot and "Live Connection".
3. **Sensor Feed** — Within 5 seconds, temperature readings start appearing in the right panel.
4. **Trigger a disruption** — Click **⚠️ LA Port Strike**. Within 3 seconds:
   - Active Disruptions KPI increments
   - A new recommendation appears in the AI Action Center
   - The Leaflet map shows a red disruption circle at Los Angeles
5. **Approve a recommendation** — Click "Approve & Execute". The recommendation disappears and Idle Fleet Assets KPI decrements.
6. **Chat Copilot** — Click the floating chat button (bottom right). Type "What shipments are affected?" and receive a watsonx.ai response.

## Troubleshooting

| Issue | Solution |
|---|---|
| `MongoServerError: connect ECONNREFUSED` | Start MongoDB: `mongod` (macOS/Linux) or start MongoDB service (Windows) |
| `npm run seed` fails with duplicate key error | Run `npm run seed` again — it clears collections before seeding |
| Dashboard shows "Disconnected" badge | Ensure backend is running on port 4000: `npm start` in `src/backend/` |
| KPI cards show 0 / no recommendations after disruption | The impact engine needs In Transit shipments — re-run `npm run seed` |
| watsonx.ai returns errors in chat | Check `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` in `src/backend/.env`. The app has grounded fallbacks so the dashboard still works. |
| `npm install` fails on Windows with node-gyp errors | Run PowerShell as Administrator: `npm install --ignore-scripts` |
| Port 4000 already in use | Kill the process: `npx kill-port 4000` then restart |
| Port 3000 already in use | Next.js auto-increments to 3001 — check the terminal output for the actual port |

## Quick Demo Walkthrough

For a 3-minute end-to-end demo:

1. Open `http://localhost:3000` — dashboard loads with 5 idle fleet assets
2. Click **⚠️ LA Port Strike** — watch the AI Action Center populate
3. Click **❄️ Chicago Blizzard** — second wave of recommendations
4. Click **Approve & Execute** on a recommendation — observe KPI update + recommendation removal
5. Wait 15–20 seconds — watch temperature spikes appear in the Live Sensor Feed (25% probability per 5s tick)
6. When a spike fires: watch the Cold Chain Alerts KPI increment and a red alert appear in Active Incidents
7. Open the AI Chat Copilot → type "Which shipments are most at risk and why?"
