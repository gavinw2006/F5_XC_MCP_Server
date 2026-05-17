import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { F5XcClient, handleApiError } from "../services/f5-xc-client.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, CHARACTER_LIMIT } from "../constants.js";

// F5 XC Health Checks (origin pool probes and standalone synthetic monitors):
//   /api/config/namespaces/{ns}/healthchecks
// Alert policies (API quirk: endpoint spells "alert_policys" not "alert_policies"):
//   /api/config/namespaces/{ns}/alert_policys
// Alert receivers (notification targets: email, Slack, PagerDuty):
//   /api/config/namespaces/{ns}/alert_receivers
// Health check spec quirk: host_header and use_origin_server_name are mutually exclusive.

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

export function registerObservabilityTools(server: McpServer, client: F5XcClient, config: AppConfig): void {

  // ── Health Checks / Synthetic Monitors ────────────────────────────────────

  server.registerTool(
    "xc_list_monitors",
    {
      title: "List F5 XC Health Check Monitors",
      description: "List health check monitors (synthetic monitors) in a namespace. Monitors are used by origin pools to probe backend health and by standalone synthetic monitoring.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list monitors from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/healthchecks`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_monitor",
    {
      title: "Get F5 XC Health Check Monitor",
      description: "Get the full specification of a health check monitor, including probe type (HTTP/HTTPS/TCP/DNS), interval, timeout, and expected response.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the monitor"),
        name: z.string().min(1).describe("Monitor name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/healthchecks/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_monitor_http",
    {
      title: "Create F5 XC HTTP Synthetic Monitor",
      description: `Create an HTTP or HTTPS health check monitor. Can be attached to origin pools or used standalone for synthetic monitoring.

Args:
  - namespace: Target namespace
  - name: Monitor name
  - host: Target hostname or IP to probe
  - port: Port to probe (e.g. 80 for HTTP, 443 for HTTPS)
  - path: HTTP path to request (default: /)
  - use_https: Whether to use HTTPS (default: false)
  - expected_status: Expected HTTP status code (default: 200)
  - interval_seconds: Probe interval in seconds (default: 15)
  - timeout_seconds: Probe timeout in seconds (default: 10)
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the monitor"),
        ...MetadataSchema,
        host: z.string().min(1).describe("Target hostname or IP address to probe"),
        port: z.number().int().min(1).max(65535).describe("TCP port to probe"),
        path: z.string().default("/").describe("HTTP path to request"),
        use_https: z.boolean().default(false).describe("Use HTTPS instead of HTTP"),
        expected_status: z.number().int().min(100).max(599).default(200).describe("Expected HTTP status code"),
        interval_seconds: z.number().int().min(5).max(3600).default(15).describe("Probe interval in seconds"),
        timeout_seconds: z.number().int().min(1).max(60).default(10).describe("Probe timeout in seconds"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, host, port, path, use_https, expected_status, interval_seconds, timeout_seconds, dryRun }) => {
      try {
        // host_header and use_origin_server_name are mutually exclusive — only set host_header
        const spec: Record<string, unknown> = {
          http_health_check: {
            host_header: host,
            path,
            ...(use_https ? { use_https: { use_host_header_as_sni: {} } } : {}),
            expected_status_codes: [String(expected_status)],
          },
          interval: interval_seconds,
          timeout: timeout_seconds,
          healthy_threshold: 1,
          unhealthy_threshold: 3,
          port,
        };
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/healthchecks`,
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
    "xc_create_monitor_dns",
    {
      title: "Create F5 XC DNS Synthetic Monitor",
      description: `Create a DNS health check monitor to probe whether a nameserver resolves a domain correctly.

Args:
  - namespace: Target namespace
  - name: Monitor name
  - dns_server: DNS server IP to query
  - query_name: Domain name to resolve (e.g. example.com)
  - expected_ip: Expected IP address in the DNS response (optional — if omitted, any response counts)
  - interval_seconds: Probe interval (default: 30)
  - timeout_seconds: Probe timeout (default: 10)
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the monitor"),
        ...MetadataSchema,
        dns_server: z.string().min(1).describe("DNS server IP to query"),
        query_name: z.string().min(1).describe("Domain name to resolve"),
        expected_ip: z.string().optional().describe("Expected IP address in DNS response"),
        interval_seconds: z.number().int().min(5).max(3600).default(30).describe("Probe interval in seconds"),
        timeout_seconds: z.number().int().min(1).max(60).default(10).describe("Probe timeout in seconds"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, dns_server, query_name, expected_ip, interval_seconds, timeout_seconds, dryRun }) => {
      try {
        const spec: Record<string, unknown> = {
          dns_health_check: {
            query_name,
            ...(expected_ip ? { expected_ip } : {}),
          },
          interval: interval_seconds,
          timeout: timeout_seconds,
          healthy_threshold: 1,
          unhealthy_threshold: 3,
          port: 53,
          host_header: dns_server,
        };
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/healthchecks`,
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
    "xc_update_monitor",
    {
      title: "Update F5 XC Health Check Monitor",
      description: "Replace a health check monitor's full specification (PUT). Retrieve the current spec with xc_get_monitor first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the monitor"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete monitor spec"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/healthchecks/${encodeURIComponent(name)}`,
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
    "xc_delete_monitor",
    {
      title: "Delete F5 XC Health Check Monitor",
      description: "Delete a health check monitor. Remove it from any origin pool references first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the monitor"),
        name: z.string().min(1).describe("Monitor name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/healthchecks/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── Alert Policies ─────────────────────────────────────────────────────────

  server.registerTool(
    "xc_list_alert_policys",
    {
      title: "List F5 XC Alert Policies",
      description: "List alert policies in a namespace. Alert policies define notification targets (email, Slack, PagerDuty) and the conditions that trigger them.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list alert policies from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/alert_policys`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_alert_policy",
    {
      title: "Create F5 XC Alert Policy",
      description: `Create an alert policy with notification targets (email, Slack webhook, PagerDuty).

Args:
  - namespace: Target namespace
  - name: Alert policy name
  - spec: Alert policy spec. Example for email + Slack notification:
      {
        "routes": [
          {
            "receiver": {
              "email": {
                "to": ["oncall@example.com"]
              }
            }
          },
          {
            "receiver": {
              "slack": {
                "url": "https://hooks.slack.com/services/...",
                "channel": "#alerts"
              }
            }
          }
        ]
      }
    For PagerDuty:
      {
        "routes": [{
          "receiver": {
            "pagerduty": {
              "service_key": "your-pagerduty-integration-key"
            }
          }
        }]
      }
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the alert policy"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("Alert policy spec (routes, receivers, notification targets)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/alert_policys`,
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
    "xc_delete_alert_policy",
    {
      title: "Delete F5 XC Alert Policy",
      description: "Delete an alert policy. Ensure no monitors or health checks reference it first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the alert policy"),
        name: z.string().min(1).describe("Alert policy name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/alert_policys/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── Alert Receivers ────────────────────────────────────────────────────────

  server.registerTool(
    "xc_list_alert_receivers",
    {
      title: "List F5 XC Alert Receivers",
      description: "List alert receivers in a namespace. Alert receivers are reusable notification targets (email, Slack, PagerDuty) referenced by alert policies.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list alert receivers from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/alert_receivers`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_alert_receiver",
    {
      title: "Create F5 XC Alert Receiver",
      description: `Create a reusable alert receiver (notification target). Alert receivers are referenced by alert policies.

Args:
  - namespace: Target namespace
  - name: Receiver name
  - spec: Receiver spec. Example for email:
      {"email": {"to": ["oncall@example.com"]}}
    For Slack:
      {"slack": {"url": "https://hooks.slack.com/services/...", "channel": "#alerts"}}
    For PagerDuty:
      {"pagerduty": {"service_key": "your-pagerduty-key"}}
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the alert receiver"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("Receiver spec (email, slack, pagerduty)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/alert_receivers`,
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
    "xc_delete_alert_receiver",
    {
      title: "Delete F5 XC Alert Receiver",
      description: "Delete an alert receiver. Remove any alert policy references to it first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the alert receiver"),
        name: z.string().min(1).describe("Alert receiver name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/alert_receivers/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
