"use strict";

const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { buildMcpServer } = require("./server.js");

function mountMcp(app, { world } = {}) {
  // GET /mcp — browser health check (also used by Bob to detect the endpoint)
  app.get("/mcp", (req, res) => {
    res.json({ status: "ok", transport: "streamable-http" });
  });

  // DELETE /mcp — session termination (stateless: always 200)
  app.delete("/mcp", (req, res) => {
    res.status(200).end();
  });

  // POST /mcp — stateless: new transport + server per request.
  // express.json() has already parsed req.body; we pass it as the third arg
  // so the SDK does NOT attempt to re-read the stream.
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    const mcpServer = buildMcpServer({ world });
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[MCP] handleRequest error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP internal error" });
      }
    }
  });
}

module.exports = { mountMcp };
