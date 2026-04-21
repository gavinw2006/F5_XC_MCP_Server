import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { F5XcClient, handleApiError } from "../services/f5-xc-client.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, CHARACTER_LIMIT } from "../constants.js";

const PaginationSchema = {
  page_start: z.number().int().min(0).default(0).describe("Pagination offset"),
  page_limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Max items to return"),
};

const DryRunSchema = {
  dryRun: z.boolean().optional().describe("Preview the API call without executing it"),
};

const MetadataSchema = {
  name: z.string().min(1).max(256).describe("Object name — unique within the namespace"),
  description: z.string().optional().describe("Human-readable description"),
  labels: z.record(z.string()).optional().describe("Key-value labels"),
};

function buildMetadata(params: { name: string; namespace: string; description?: string; labels?: Record<string, string> }): Record<string, unknown> {
  return {
    name: params.name,
    namespace: params.namespace,
    ...(params.description ? { description: params.description } : {}),
    ...(params.labels ? { labels: params.labels } : {}),
  };
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Truncated. Use page_start/page_limit to paginate.]`;
}

export function registerSecurityTools(server: McpServer, client: F5XcClient, config: AppConfig): void {

  // ── App Firewalls (WAF) ───────────────────────────────────────────────────

  server.registerTool(
    "xc_list_app_firewalls",
    {
      title: "List F5 XC App Firewalls (WAF Policies)",
      description: "List Web Application Firewall (app firewall) policies in a namespace. App firewalls are attached to HTTP load balancers to provide WAF protection.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list app firewalls from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_firewalls`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_app_firewall",
    {
      title: "Get F5 XC App Firewall (WAF Policy)",
      description: "Get full details of a WAF app firewall policy, including detection settings, blocking mode, signature exclusions, and custom rules.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the app firewall"),
        name: z.string().min(1).describe("App firewall name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_firewalls/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_app_firewall",
    {
      title: "Create F5 XC App Firewall (WAF Policy)",
      description: `Create a Web Application Firewall policy. Attach to an HTTP LB via xc_update_http_lb.

Args:
  - namespace: Target namespace
  - name: Policy name
  - spec: App firewall spec. Example for blocking mode with OWASP:
      {
        "blocking": {},
        "detection_settings": {
          "signature_selection_setting": {"medium_accuracy_signatures": {}},
          "enable_suppression": {},
          "enable_threat_campaigns": {}
        },
        "allow_all_response_codes": {},
        "default_anonymization": {},
        "use_default_blocking_page": {}
      }
  For detection-only (monitoring): replace "blocking" with "detection"
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the app firewall"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("App firewall spec (mode, detection settings, exclusions, etc.)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_firewalls`,
          body: { metadata: buildMetadata({ name, namespace, description, labels }), spec },
          dryRun,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_update_app_firewall",
    {
      title: "Update F5 XC App Firewall (WAF Policy)",
      description: "Replace a WAF app firewall policy specification (full PUT replace). Retrieve the current spec with xc_get_app_firewall first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the app firewall"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete app firewall specification"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_firewalls/${encodeURIComponent(name)}`,
          body: { metadata: buildMetadata({ name, namespace, description, labels }), spec },
          dryRun,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_delete_app_firewall",
    {
      title: "Delete F5 XC App Firewall (WAF Policy)",
      description: "Delete a WAF app firewall policy. Detach it from all HTTP LBs first (update those LBs to use disable_waf), otherwise the delete will fail.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the app firewall"),
        name: z.string().min(1).describe("App firewall name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_firewalls/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── Service Policies (API Protection, Bot Defense rules, DDoS) ────────────

  server.registerTool(
    "xc_list_service_policies",
    {
      title: "List F5 XC Service Policies",
      description: "List service policies in a namespace. Service policies control API protection, Bot Defense rules, DDoS mitigation, and traffic allow/deny rules that apply to HTTP load balancers.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list service policies from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/service_policies`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_service_policy",
    {
      title: "Get F5 XC Service Policy",
      description: "Get the full specification of a service policy, including rules, conditions, actions, and Bot Defense/DDoS settings.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the service policy"),
        name: z.string().min(1).describe("Service policy name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/service_policies/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_service_policy",
    {
      title: "Create F5 XC Service Policy",
      description: `Create a service policy for API protection, Bot Defense rules, or DDoS mitigation. Service policies are applied to HTTP LBs via service_policies_from_namespace or explicit references.

Args:
  - namespace: Target namespace
  - name: Policy name
  - spec: Service policy spec. Example for IP-based allow/deny:
      {
        "algo": "FIRST_MATCH",
        "any_server": {},
        "rule_list": {
          "rules": [{
            "metadata": {"name": "block-bad-ips"},
            "spec": {
              "action": "DENY",
              "ip_prefix_list": {"ip_prefixes": ["192.0.2.0/24"]},
              "any_client": {}
            }
          }]
        }
      }
  For Bot Defense rules, include "bot_action" in the rule spec.
  For rate limiting (DDoS): use "rate_limiter" with "total_number" and "per_period".
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the service policy"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("Service policy spec (rules, algo, conditions, actions, rate limiting, etc.)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/service_policies`,
          body: { metadata: buildMetadata({ name, namespace, description, labels }), spec },
          dryRun,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_update_service_policy",
    {
      title: "Update F5 XC Service Policy",
      description: "Replace a service policy's full specification (PUT). Retrieve the current spec with xc_get_service_policy first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the service policy"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete service policy specification"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/service_policies/${encodeURIComponent(name)}`,
          body: { metadata: buildMetadata({ name, namespace, description, labels }), spec },
          dryRun,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_delete_service_policy",
    {
      title: "Delete F5 XC Service Policy",
      description: "Delete a service policy. Remove it from any HTTP LB service policy sets first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the service policy"),
        name: z.string().min(1).describe("Service policy name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/service_policies/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
