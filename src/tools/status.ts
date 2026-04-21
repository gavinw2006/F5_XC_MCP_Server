import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../types.js";
import { TerraformRunner } from "../services/terraform-runner.js";

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
      const tf = new TerraformRunner(config);

      const authMethod = config.certPath && config.keyPath
        ? "certificate (mTLS)"
        : config.apiToken
          ? "API token"
          : "none — configure F5_XC_API_TOKEN or F5_XC_CERT_PATH + F5_XC_KEY_PATH";

      const tfAuth = tf.isAuthConfigured()
        ? (config.certPath && config.keyPath ? "PEM cert+key" : "p12 file")
        : "not configured — set F5_XC_CERT_PATH+F5_XC_KEY_PATH or F5_XC_P12_PATH";

      const payload = {
        tenant: config.tenant || "(not set)",
        baseUrl: config.baseUrl || "(not set — set F5_XC_TENANT or F5_XC_BASE_URL)",
        defaultNamespace: config.defaultNamespace,
        authMethod,
        dryRun: config.dryRun,
        dryRunNote: config.dryRun
          ? "SAFE MODE: All mutating calls return previews. Set F5_XC_DRY_RUN=false to enable live calls."
          : "LIVE MODE: Mutating calls will interact with F5 XC.",
        terraform: {
          bin: config.tfBin ?? "terraform (system PATH)",
          auth: tfAuth,
          note: tf.isAuthConfigured()
            ? "Terraform fallback is available for user_group, namespace, and all resource types."
            : "Terraform fallback requires cert auth. REST API is still available.",
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );
}
