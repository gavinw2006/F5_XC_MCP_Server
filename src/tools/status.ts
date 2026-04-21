import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../types.js";

export function registerStatusTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "xc_server_status",
    {
      title: "F5 XC MCP Server Status",
      description: "Show the current server configuration: tenant, base URL, default namespace, dry-run state, and API token presence. Use this to verify the server is configured correctly before running operations.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const payload = {
        tenant: config.tenant || "(not set)",
        baseUrl: config.baseUrl || "(not set — set F5_XC_TENANT or F5_XC_BASE_URL)",
        defaultNamespace: config.defaultNamespace,
        apiTokenConfigured: !!config.apiToken,
        dryRun: config.dryRun,
        dryRunNote: config.dryRun
          ? "SAFE MODE: All mutating calls return previews. Set F5_XC_DRY_RUN=false to enable live calls."
          : "LIVE MODE: Mutating calls will interact with F5 XC.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );
}
