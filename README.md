# LIFECLOCK

> **Every cold shipment has two deadlines: when it is late, and when it is dead.**
> LIFECLOCK computes both, tells you which one bites first, and refuses any
> reroute that outlasts the cargo.
>
> Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
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

A cold-chain control tower built on one idea: a shipment has **two clocks**. The
schedule clock is hours until it is late. The stability clock is hours until the
cargo is no longer usable. Whichever is smaller is its **life clock**, and every
engine in the product reads it.

That split produces decisions a cost-and-time router cannot reach. When a port
strike stops a vessel, holding it on ship power *freezes the stability clock*
while the schedule clock keeps running — so "wait" can beat "reroute" even
though it arrives later. And a route that is cheaper and faster is **rejected as
infeasible** when it outlasts the cargo, shown struck through with the shortfall
rather than quietly dropped.

Severity, disposition and the clock are decided by rule engines, never by the
model. watsonx explains the engine's conclusion afterwards, and when it is
unavailable nothing on screen changes.

IBM Bob operates the tower through 12 MCP tools — and is **refused** when it
tries to commit a decision, with the refusal written into a hash-chained audit
trail you can verify in the UI.

## ✨ Key Features

- **The life clock.** Two clocks per shipment — schedule and stability — with the
  binding one marked. Delay drains it, excursions drain it faster, depot power
  stops it. `engines/viabilityClock.js`
- **Breach prediction, not breach detection.** A Newton's-law-of-cooling fit over
  recent readings says *"breach in 31 minutes, high confidence"* while the cargo
  is still in range. `engines/breachPredictor.js`
- **Regulatory severity by rule, not by prompt.** A magnitude × duration matrix
  with a freeze override, cumulative band budgets, mean kinetic temperature, a
  disposition and who must sign it — all tied to a versioned rule profile that
  history is never re-judged under. `engines/regulatoryEngine.js`
- **Real routing over real geography.** Dijkstra plus Yen's k-shortest across 40
  nodes and 18 lanes, with blocked and delayed nodes, landed cost (freight +
  fees + customs dwell + duty + expected spoilage) and CO₂ per option.
- **Impact on the remaining path.** Point-to-segment intersection answering
  *"enters the zone in 6.2 h"* or *"already past it"* — not just yes or no.
- **A fleet matcher that respects physics.** Mode, temperature range, driver
  hours, maintenance and pre-cool time are hard filters; scores are 0–100 and
  every rejection carries its reason.
- **Bob proposes, humans commit.** 12 MCP tools; the committing ones refuse an
  agent and log the refusal into a verifiable hash chain.
- **Runs on nothing.** No API key, no MongoDB, no network — `npm start` boots and
  seeds itself.

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

Runs with **no API key, no MongoDB and no internet**. Those add capability;
they are not prerequisites. Full detail in [`docs/setup-guide.md`](docs/setup-guide.md).

```bash
# Prerequisite: Node.js 18, 20 or 22

git clone https://github.com/priyank-projectwork/bob-ai-hackathon-error-fellows.git
cd bob-ai-hackathon-error-fellows

# Terminal 1 — backend (seeds itself if MongoDB is absent)
cd src/backend
npm install
npm start

# Terminal 2 — frontend
cd src/frontend
npm install
npm run dev
```

Confirm you are on the current build — `curl http://localhost:4000/health`
should report `"build": "lifeclock-r2"`.

With MongoDB running, `npm run seed` first for a world that persists.
With watsonx credentials in `src/backend/.env`, explanations come from the
model instead of templates — **every number is identical either way**.

```bash
npm test               # 165 tests
npm run record         # drive the real engines, write a recording
npm run record:verify  # confirm the recording matches its hash
npm run demo           # replay it, no database or network needed
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

Kept deliberately specific — see [`docs/known-limitations.md`](docs/known-limitations.md)
for the full list, including which numbers are illustrative.

- **Authentication is a single named operator**, not an identity provider.
  Custody is recorded as data; multiple organisations and per-party views are not built.
- **The audit chain is tamper-evident, not a signature.** Designed toward
  21 CFR Part 11 principles; not validated, not a compliance claim.
- **Duty rates and customs dwell are illustrative.** The direction is real —
  vaccines are duty-free into many markets — but no rate should be quoted.
- **Approve records a signed decision but does not yet re-route the world**;
  the map does not redraw on approval.
- **Delay does not propagate between legs.** Shipments have real multi-leg
  routes, but missed-connection cascade is not implemented.
- **No live weather or news feed.** `parse_headline` structures a headline you
  paste; nothing polls externally.
- **No deployment.** `demo/live-demo-url.txt` says `NOT DEPLOYED`.

---

## 🏅 What We're Most Proud Of

**The two-clock model, and that it is a hard constraint rather than a weight.**

A cold shipment has two deadlines: when it is late, and when it is dead. Most
systems track the first. LIFECLOCK computes both, says which one binds, and
**rejects any route that outlasts the cargo** — shown struck through with the
shortfall rather than quietly dropped. A soft weight would let a fast, cheap
route that spoils the cargo win; a constraint cannot.

That split produces answers a cost-and-time router cannot reach. Holding a
vessel on ship power freezes the stability clock while the schedule clock keeps
running, so *waiting* can beat *rerouting*.

Two things make it checkable rather than claimed:

- **The engines are pure.** No database, no network, no wall-clock reads —
  `grep -rn "Date.now" src/backend/engines/*.js` returns nothing. 165 tests.
  Severity comes from a rule matrix, not a prompt; pull the watsonx credentials
  and every number on screen is identical.
- **An agent may propose; only a human commits.** IBM Bob operates the tower
  through 12 MCP tools and is **refused** when it tries to approve a decision —
  with the refusal written into a hash chain you can verify on screen.

The honest part: the backend is stronger than the front end, and
`docs/known-limitations.md` says exactly where.
