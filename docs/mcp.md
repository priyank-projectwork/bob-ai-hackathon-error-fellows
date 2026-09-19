# LIFECLOCK MCP tools

IBM Bob operates LIFECLOCK through these tools. They are served over Streamable
HTTP from the backend process itself at `POST /mcp`, so there is no second
package to build, no path in the config, and no copy of the logic that can drift
— the tools call the same engines and services the UI calls.

Configure Bob with `.bob/mcp.json`:

```json
{ "mcpServers": { "lifeclock": { "type": "streamable-http", "url": "http://127.0.0.1:4000/mcp" } } }
```

## The rule

**Bob may read and propose. Bob may not commit.**

Every tool declares an action, and that action goes through `engines/policy.js`.
Reading and proposing are allowed. Approving a recommendation, dispatching an
asset and signing a disposition are *committing* actions: an agent is refused
whatever role it holds, and the refusal is written into the hash-chained audit
trail with actor `bob`.

The committing tools are deliberately present and wired. Watching Bob get
stopped is the point — it is the difference between an assistant and an
autopilot, and it is verifiable in `GET /api/v1/audit`.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `ping` | read | Health check |
| `list_at_risk` | read | Shipments ranked by least cargo life remaining |
| `get_life_clock` | read | Both clocks for one shipment, and which one binds |
| `get_excursion` | read | Severity, the rule that produced it, MKT, root cause, custody |
| `fleet_status` | read | Utilisation, idle hours, what idling costs |
| `find_rescue_asset` | read | Ranked rescue candidates, with reasons for every rejection |
| `world_status` | read | Simulated clock, shipments moving, open excursions |
| `parse_headline` | propose | News headline → structured disruption draft |
| `draft_deviation_report` | propose | GDP-style deviation draft for a QA/RP to sign |
| `morning_brief` | propose | Shift handover: risk, excursions, fleet |
| `approve_recommendation` | **commit** | Refused for an agent — human only |
| `dispatch_asset` | **commit** | Refused for an agent — human only |

## Deferred

Not built for this submission, and not claimed: `what_if` (re-rank options under
an operator's constraints), `classify_csv` (analyse an uploaded logger export),
`reposition_fleet`, `switch_carrier`, `acknowledge_alert`, `sign_disposition`.
Each needs a screen to act on it, and a tool without a place to land is
decoration.

## Reproducing it

1. `cd src/backend && npm install && npm start` — boots with no key, no MongoDB
   and no network.
2. Point Bob at `http://127.0.0.1:4000/mcp` using the config above and restart Bob.
3. The `lifeclock` server shows as connected with 12 tools.
4. Ask Bob: *"which shipments are at risk?"* then *"approve the top recommendation"*.
   The first works. The second is refused, and the refusal appears in
   `GET /api/v1/audit` with `outcome: "denied"`.
