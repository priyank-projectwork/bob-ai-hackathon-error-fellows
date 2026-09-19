# How IBM Bob is used

Two ways: Bob helped build LIFECLOCK, and Bob operates it. The second is the
one that matters — it is load-bearing, not a mention.

## 1. Bob operates the product

LIFECLOCK exposes 12 MCP tools over Streamable HTTP from the backend process
itself. Bob is configured with a URL and no file path:

```json
{ "mcpServers": { "lifeclock": { "type": "streamable-http", "url": "http://127.0.0.1:4000/mcp" } } }
```

`.bob/custom_modes.yaml` defines a **Control Tower** mode: granted `read`, `mcp`
and `todo`, and deliberately **not** `edit` or `command`. The mode operates the
product; it does not modify the codebase.

Three slash commands ship with it: `/morning-brief`, `/headline`,
`/deviation-report`. Each is in `.bob/commands/`.

### The rule Bob runs under

**Bob may read and propose. Bob may not commit.**

Every tool declares an action, checked against `engines/policy.js`. Reading and
proposing are allowed. Approving a recommendation, dispatching an asset and
signing a disposition are *committing* actions — an agent is refused whatever
role it holds.

The committing tools exist and are wired. Ask Bob to approve something and it is
refused, with an explanation it can act on, and **the refusal is written into
the hash-chained audit trail** with actor `bob`:

```
seq=2  dispatch_asset   denied   VX-2291
```

That row is the evidence. Run `GET /api/v1/audit/verify` and the chain confirms
it has not been edited since.

A `PostToolUse` hook (`.bob/settings.json` → `scripts/bob-audit-hook.js`) posts
every `mcp__lifeclock` call to the audit endpoint, so Bob's reads are logged
alongside the humans' decisions.

### Reproducing it in five minutes

1. `cd src/backend && npm install && npm start` — boots with no API key, no
   MongoDB and no network.
2. Put the config above in `.bob/mcp.json` and restart Bob.
3. The `lifeclock` server shows **connected**, 12 tools listed.
4. Ask *"which shipments are at risk?"* → answered from the engines.
5. Ask *"approve the top recommendation"* → refused.
6. `curl localhost:4000/api/v1/audit` → the refusal is there.

See `docs/mcp.md` for the full tool table.

## 2. Bob during development

Bob was used in Agent mode against this repository. Work done through Bob
includes the MCP transport, the boot-hardening pass that lets the server run
without credentials or a database, and the five pure cold-chain engines with
their test tables.

Session exports live outside git (`bob-task-*.json` at the repo root are
gitignored — they are 13 MB and contain full prompt transcripts). To inspect
them, ask the team.

## Honest notes

- Bob's mode and hook schemas were taken from the public documentation. Where a
  key could not be verified, the file says so in a comment and the feature
  degrades rather than breaking.
- The hook reads its stdin payload defensively because the exact shape Bob
  provides is not documented; it never blocks a tool call.
- Earlier session exports contain **no** MCP tool calls — the tools existed but
  were never used. That is precisely what this submission changed.
