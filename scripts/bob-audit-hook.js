#!/usr/bin/env node
/**
 * PostToolUse hook: record every LIFECLOCK MCP call Bob makes into the
 * hash-chained audit trail, so the agent's activity is auditable alongside
 * the humans'.
 *
 * Wire it in .bob/settings.json with matcher ^mcp__lifeclock.
 * The exact stdin payload shape Bob provides was not verifiable from public
 * docs — this reads defensively and never blocks the tool call.
 */
"use strict";

const API = process.env.LIFECLOCK_API_URL || "http://127.0.0.1:4000";

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch (_) { /* keep going */ }

  const tool = payload.tool_name || payload.toolName || payload.tool || "unknown";
  const args = payload.tool_input || payload.arguments || payload.args || null;

  try {
    await fetch(`${API}/api/v1/audit/bob-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, args }),
    });
  } catch (_) {
    // Never fail the tool call because the audit endpoint is unreachable.
  }
  process.exit(0);
});
