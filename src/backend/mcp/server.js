"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { toolDefinitions, guarded } = require("./tools.js");

/**
 * Build the LIFECLOCK MCP server.
 *
 * Every tool is registered through `guarded`, so policy is checked and the call
 * is audited whoever is on the other end. The tools call the same services the
 * UI calls, in the same process — there is no second copy of the logic.
 */
function buildMcpServer({ world }) {
  const server = new McpServer({ name: "lifeclock", version: "1.0.0" });

  server.tool(
    "ping",
    "Health check for the LIFECLOCK MCP server",
    {},
    async () => ({ content: [{ type: "text", text: "LIFECLOCK MCP online" }] })
  );

  for (const def of toolDefinitions({ world })) {
    server.tool(
      def.name,
      def.description,
      def.schema,
      guarded(def.action, def.entityType, def.handler)
    );
  }

  return server;
}

module.exports = { buildMcpServer };
