#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { loadConfig } from "./services/config.js";
import { F5XcClient } from "./services/f5-xc-client.js";
import { TerraformRunner } from "./services/terraform-runner.js";
import { registerStatusTool } from "./tools/status.js";
import { registerIdentityTools } from "./tools/identity.js";
import { registerLoadBalancerTools } from "./tools/load-balancer.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerApiSecurityTools } from "./tools/api-security.js";
import { registerTerraformTools } from "./tools/terraform.js";

const config = loadConfig();
const xcClient = new F5XcClient(config);
const tfRunner = new TerraformRunner(config);

const server = new McpServer({
  name: "f5-xc-mcp-server",
  version: "1.0.0",
});

registerStatusTool(server, config);
registerIdentityTools(server, xcClient, config);
registerLoadBalancerTools(server, xcClient, config);
registerSecurityTools(server, xcClient, config);
registerApiSecurityTools(server, xcClient, config);
registerTerraformTools(server, tfRunner, config);

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("F5 XC MCP server running via stdio");
  console.error(`Tenant: ${config.tenant || "(not set)"}`);
  console.error(`Dry-run: ${config.dryRun}`);
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", tenant: config.tenant || "(not set)", dryRun: config.dryRun });
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`F5 XC MCP server running on http://localhost:${port}/mcp`);
    console.error(`Tenant: ${config.tenant || "(not set)"}`);
    console.error(`Dry-run: ${config.dryRun}`);
  });
}

const transport = process.env.TRANSPORT ?? "stdio";
if (transport === "http") {
  runHttp().catch((err: unknown) => {
    console.error("Server error:", err);
    process.exit(1);
  });
} else {
  runStdio().catch((err: unknown) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}
