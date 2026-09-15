# Presentation — SupplyChain AI Copilot

Slide deck file: **`slides.pptx`** (present in this directory)

---

## Team

| Role | Name | Email |
|---|---|---|
| **Lead** | Nilkanth Patel | 25msit125@charusat.edu.in |
| Member | Manav Shah | 25mca154@charusat.edu.in |
| Member | Priyank Patel | 25mca120@charusat.edu.in |
| Member | Prachi Patel | 25mca119@charusat.edu.in |

---

## Deck Structure — 8 Slides

### Slide 1 — Title
**SupplyChain AI Copilot**
*Supply Chain Disruption Assistant & Fleet Utilisation Optimizer*
Team: Error Fellows | Track: AI | IBM Bob AI Hackathon 2026
Detect → Assess → Optimise → Act

---

### Slide 2 — The Problem
**Two crises hitting at the same time**
- Disruption Blindness — 2–4 hours manual triage per event
- Cold-chain failure found too late — discovered at dock after delivery
- Pain numbers: $500K+ cargo loss, $10B+ port event impact, 4–8 hrs per GDP report

---

### Slide 3 — The Solution
**A real-time supply chain control tower**
- Detect → Score → Optimise → Act → Monitor
- Deterministic engines calculate · watsonx.ai explains · the operator decides

---

### Slide 4 — Architecture
**Deterministic engines + AI overlay**
- IoT → Cold Chain Engine → watsonx.ai GDP Classification
- Disruption → Impact Engine → Risk Engine → Route Optimizer → Fleet Matcher
- Operator Chat → watsonx.ai Copilot (live context)
- Stack: Next.js 16 · React 19 · Express 5 · Socket.IO · MongoDB 7 · @ibm-cloud/watsonx-ai

---

### Slide 5 — Live Demo Walkthrough
**LA Port Strike scenario**
- SHIP-001: CRITICAL 87/100, SHIP-003: HIGH 72/100, SHIP-005: WATCH 61/100
- Reroute via Denver hub, assign truck T-002

---

### Slide 6 — IBM Technology Integration
**Load-bearing, not decorative**
- watsonx.ai (Llama 4 Maverick): 3 call types — GDP classification, rerouting strategy, copilot Q&A
- IBM Bob MCP Server: 6 tools connecting Bob to live operational data
- IBM Bob: AI coding agent used throughout development

MCP tools: `get_active_disruptions` · `get_affected_shipments` · `get_shipment_risk` · `get_cold_chain_status` · `get_idle_fleet_assets` · `get_action_center`

---

### Slide 7 — Business Impact
**What this changes**

| Metric | Before | After |
|---|---|---|
| Disruption triage | 2–4 hours | < 5 seconds |
| Excursion detection | At delivery (too late) | Real-time, pre-delivery |
| GDP severity classification | 4–8 hrs quality manager | Instant, watsonx.ai-grounded |
| Fleet redeployment | Email & phone calls | One-click approval |
| Audit trail | Spreadsheet | Immutable, timestamped |
| Shipments monitored | Manual (~10) | Unlimited, continuous |

---

### Slide 8 — Team & What's Next
**Team Error Fellows**
- Lead: Nilkanth Patel
- Members: Manav Shah, Priyank Patel, Prachi Patel
- What we're most proud of: Strict separation of deterministic computation from generative AI
- What this could become: Live disruption feeds, real TMS routing, IBM Cloud deployment, multi-tenant MCP tools
