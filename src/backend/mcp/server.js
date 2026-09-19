"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");

function buildMcpServer() {
  const server = new McpServer({ name: "lifeclock", version: "0.1.0" });

  server.tool(
    "ping",
    "Health check for the LIFECLOCK MCP server",
    {}, // empty input schema
    async () => ({
      content: [{ type: "text", text: "LIFECLOCK MCP online" }],
    })
  );

  return server;
}

module.exports = { buildMcpServer };
