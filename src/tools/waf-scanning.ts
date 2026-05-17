import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { F5XcClient, handleApiError } from "../services/f5-xc-client.js";
import https from "https";

// F5 XC Web App Scanning (formerly Heyhack) is a SEPARATE SaaS service.
// It does NOT use the standard F5 XC tenant API at console.ves.volterra.io.
//
// API base URL: https://app.heyhack.com
// Authentication: Authorization: Heyhack <API_KEY>  (NOT APIToken)
// API key env var: F5_XC_WAS_API_KEY (set in .env)
//
// Key endpoints:
//   GET  /api/findings                     List all vulnerability findings
//   GET  /api/findings?applicationId=<id>  Findings filtered by app
//   POST /api/scanjobs                     Start a new scan job
//   GET  /api/recon/findings               Recon findings for all jobs
//   GET  /api/recon/{id}/findings          Recon findings for a specific job
//   GET  /api/recon/services               Services discovered by recon jobs

const WAS_BASE = "app.heyhack.com";

function wasRequest(apiKey: string, method: string, path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const opts: https.RequestOptions = {
      hostname: WAS_BASE,
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Heyhack ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch {
          resolve({ _raw: data });
        }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function getApiKey(): string | undefined {
  return process.env.F5_XC_WAS_API_KEY?.trim();
}

function missingKeyError(): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{
      type: "text",
      text: "F5_XC_WAS_API_KEY is not set. Web App Scanning uses a separate API (app.heyhack.com) with its own key. Set F5_XC_WAS_API_KEY in .env to enable these tools.",
    }],
  };
}

export function registerWafScanningTools(server: McpServer, _client: F5XcClient, _config: AppConfig): void {

  // ── Web App Scanning (app.heyhack.com) ────────────────────────────────────

  server.registerTool(
    "xc_was_list_findings",
    {
      title: "List F5 XC Web App Scan Findings",
      description: `List vulnerability findings from F5 XC Web App Scanning (DAST). Requires F5_XC_WAS_API_KEY env var.

Web App Scanning uses a separate API at app.heyhack.com — set F5_XC_WAS_API_KEY in .env before using these tools.

Args:
  - application_id: Optional — filter findings by application ID`,
      inputSchema: z.object({
        application_id: z.string().optional().describe("Optional application ID to filter findings"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ application_id }) => {
      const apiKey = getApiKey();
      if (!apiKey) return missingKeyError();
      try {
        const path = application_id ? `/api/findings?applicationId=${encodeURIComponent(application_id)}` : "/api/findings";
        const result = await wasRequest(apiKey, "GET", path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_was_start_scan",
    {
      title: "Start F5 XC Web App Scan Job",
      description: `Start a new DAST scan job against an application. Requires F5_XC_WAS_API_KEY env var.

Args:
  - profile_id: Scan profile ID (determines scan intensity and checks)
  - application_id: Application ID to scan`,
      inputSchema: z.object({
        profile_id: z.string().min(1).describe("Scan profile ID"),
        application_id: z.string().min(1).describe("Application ID to scan"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ profile_id, application_id }) => {
      const apiKey = getApiKey();
      if (!apiKey) return missingKeyError();
      try {
        const result = await wasRequest(apiKey, "POST", "/api/scanjobs", { profileId: profile_id, applicationId: application_id });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_was_list_recon_findings",
    {
      title: "List F5 XC Web App Recon Findings",
      description: `List reconnaissance findings from F5 XC Web App Scanning. Recon discovers exposed services and assets. Requires F5_XC_WAS_API_KEY env var.

Args:
  - recon_id: Optional — ID of a specific recon job. If omitted, returns findings for all jobs.`,
      inputSchema: z.object({
        recon_id: z.string().optional().describe("Optional recon job ID for specific results"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ recon_id }) => {
      const apiKey = getApiKey();
      if (!apiKey) return missingKeyError();
      try {
        const path = recon_id ? `/api/recon/${encodeURIComponent(recon_id)}/findings` : "/api/recon/findings";
        const result = await wasRequest(apiKey, "GET", path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_was_list_recon_services",
    {
      title: "List F5 XC Web App Recon Services",
      description: `List services discovered by reconnaissance jobs in F5 XC Web App Scanning. Requires F5_XC_WAS_API_KEY env var.

Args:
  - recon_id: Optional — ID of a specific recon job. If omitted, returns services for all jobs.`,
      inputSchema: z.object({
        recon_id: z.string().optional().describe("Optional recon job ID for specific results"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ recon_id }) => {
      const apiKey = getApiKey();
      if (!apiKey) return missingKeyError();
      try {
        const path = recon_id ? `/api/recon/${encodeURIComponent(recon_id)}/services` : "/api/recon/services";
        const result = await wasRequest(apiKey, "GET", path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
