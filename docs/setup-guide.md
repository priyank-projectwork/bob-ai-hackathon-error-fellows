# Setup guide

Written for someone who has never seen this repo. It runs with **no API key,
no MongoDB and no internet** — those only add capability, they are not
prerequisites.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 18, 20 or 22 | everything |
| npm | ships with Node | everything |
| MongoDB | 7 (**optional**) | persistence between restarts |
| IBM Bob | any recent build (**optional**) | the agent integration |

## 1. Clone and install

```bash
git clone https://github.com/priyank-projectwork/bob-ai-hackathon-error-fellows.git
cd bob-ai-hackathon-error-fellows

cd src/backend  && npm install
cd ../frontend  && npm install
```

## 2. Run it

**Terminal 1 — backend**

```bash
cd src/backend
npm start
```

Expected output with no MongoDB installed:

```
⚠️  MongoDB unavailable — starting in memory mode (data will not persist)
✅ In-memory MongoDB connected
🌱 Auto-seeded 45 shipments and 41 assets (in-memory store)
🚀 Server running on http://127.0.0.1:4000
```

With MongoDB running, seed it once first:

```bash
npm run seed     # 45 shipments across 13 lanes, 68 route legs, 41 assets, 5 rule profiles
npm start
```

**Terminal 2 — frontend**

```bash
cd src/frontend
npm run dev
```

Open **http://localhost:3000**.

## 3. Check you are on the current build

```bash
curl http://localhost:4000/health
```

```json
{
  "status": "ok",
  "build": "lifeclock-r2",
  "features": ["sim", "lifeclock", "mcp", "audit-chain", "graph-router"],
  "store": "memory",
  "ai": "fallback"
}
```

**If `build` is missing, an older server is still running.** The simulation
controls, the moving map and the analytics chart all call routes that did not
exist before, and they will appear broken. Stop that process and start again.

## 4. Verify it works

| Check | Expected |
|---|---|
| `npm test` in `src/backend` | 165 tests pass |
| `curl localhost:4000/api/v1/lifeclock` | 45 clocks, worst first, each with both margins |
| Press **Play**, set **600×** | Pins advance every couple of seconds, pointing along their heading |
| Click a scenario card | Recommendations appear with ranked options |
| **See on Map** | Blocked route in red, alternative in green |
| **Verify chain** in the audit panel | `Intact — N records` |
| Toggle **Light / Auto / Dark** | Whole page changes, including the map tiles |

## 5. Optional — watsonx explanations

Copy `src/.env.example` to `src/backend/.env` and fill in:

```
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_URL=https://us-south.ml.cloud.ibm.com
MODEL_ID=meta-llama/llama-4-maverick-17b-128e-instruct-fp8
```

Without it, `/health` reports `"ai": "fallback"` and explanations use templates.
**Every number on screen is identical either way** — the engines decide, the
model only phrases.

## 6. Optional — IBM Bob

`.bob/mcp.json` is already configured:

```json
{ "mcpServers": { "lifeclock": { "type": "streamable-http", "url": "http://127.0.0.1:4000/mcp" } } }
```

Restart Bob, open the MCP panel — `lifeclock` should show connected with 12
tools. Then ask it *"which shipments are at risk?"* and afterwards *"approve the
top recommendation"*. The first works. The second is **refused**, and the
refusal appears in `GET /api/v1/audit`. See `docs/bob-usage.md`.

## 7. The demo without a database or a network

```bash
cd src/backend
npm run record         # drives the real engines, writes recordings/in-ke.ndjson
npm run record:verify  # confirms the recording matches its manifest hash
npm run demo           # replays it
```

The recording is engine output, not a script. Delete it, re-run `npm run record`
with the same seed, and you get the same file.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Play/pause does nothing; nothing moves | Backend predates the sim routes | Check `/health` for `build`; restart the backend |
| "Simulation controls unavailable" | Backend not reachable on `NEXT_PUBLIC_API_URL` | Confirm it is up on port 4000 |
| Analytics chart empty | No readings yet | Press Play and wait a few seconds |
| Map is a blank rectangle | OpenStreetMap tiles blocked | Needs internet for tiles; everything else works offline |
| Server hangs ~15 s on boot | Probing for MongoDB | Normal without Mongo; it falls through to memory mode |
| `npm run build` fails on `lightningcss` | `node_modules` installed on a different OS | Delete `node_modules` and reinstall on this machine |
| Port 4000 in use | An older instance is still running | Kill it, or set `PORT=4001` and `NEXT_PUBLIC_API_URL` to match |
