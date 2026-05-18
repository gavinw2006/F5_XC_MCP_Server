import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { F5XcClient, handleApiError } from "../services/f5-xc-client.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, CHARACTER_LIMIT } from "../constants.js";

// F5 XC Synthetic Monitor API (Observability):
//   HTTP monitors: /api/observability/synthetic_monitor/namespaces/{ns}/v1_http_monitors
//   DNS monitors:  /api/observability/synthetic_monitor/namespaces/{ns}/v1_dns_monitors
//
// These are standalone synthetic probes that run from F5 XC PoP locations or cloud
// provider regions — NOT the healthcheck probes used by origin pools
// (those live at /api/config/namespaces/{ns}/healthchecks).
//
// Alert policies (API quirk: endpoint spells "alert_policys" not "alert_policies"):
//   /api/config/namespaces/{ns}/alert_policys
// Alert receivers (notification targets: email, Slack, PagerDuty):
//   /api/config/namespaces/{ns}/alert_receivers

const BASE_HTTP = "/api/observability/synthetic_monitor/namespaces";
const BASE_DNS = "/api/observability/synthetic_monitor/namespaces";

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

// Build the external_sources array from a probe_source + regions pair.
// source: "f5xc" | "aws" | "gcp" | "azure"
// regions: array of region strings, e.g. ["ves-io-melbourne"] or ["ap-southeast-1"]
function buildExternalSources(probeSource: string, probeRegions: string[]): unknown[] {
  return [{ [probeSource]: { regions: probeRegions } }];
}

// Build the interval key. F5 XC uses presence-based oneOf: interval_30_sec, interval_1_min,
// interval_5_min, interval_10_min, interval_30_min, interval_1_hour
function buildInterval(intervalMinutes: number): Record<string, unknown> {
  if (intervalMinutes <= 0.5) return { interval_30_sec: {} };
  if (intervalMinutes <= 1) return { interval_1_min: {} };
  if (intervalMinutes <= 5) return { interval_5_min: {} };
  if (intervalMinutes <= 10) return { interval_10_min: {} };
  if (intervalMinutes <= 30) return { interval_30_min: {} };
  return { interval_1_hour: {} };
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Truncated. Use page_start/page_limit to paginate.]`;
}

export function registerObservabilityTools(server: McpServer, client: F5XcClient, config: AppConfig): void {

  // ── HTTP Synthetic Monitors ────────────────────────────────────────────────

  server.registerTool(
    "xc_list_monitors",
    {
      title: "List F5 XC Synthetic Monitors",
      description: "List synthetic monitors in a namespace. Use monitor_type to select HTTP or DNS monitors. Synthetic monitors send probes from F5 XC PoP locations to external targets — they are NOT the same as origin pool health checks.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list monitors from"),
        monitor_type: z.enum(["http", "dns"]).default("http").describe("Monitor type: http or dns"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, monitor_type, page_start, page_limit }) => {
      try {
        const resource = monitor_type === "dns" ? "v1_dns_monitors" : "v1_http_monitors";
        const result = await client.request({
          method: "GET",
          path: `${BASE_HTTP}/${encodeURIComponent(namespace)}/${resource}`,
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
      title: "Get F5 XC Synthetic Monitor",
      description: "Get the full specification of a synthetic monitor (HTTP or DNS). Includes probe locations, check intervals, and response assertions.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the monitor"),
        name: z.string().min(1).describe("Monitor name"),
        monitor_type: z.enum(["http", "dns"]).default("http").describe("Monitor type: http or dns"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, monitor_type }) => {
      try {
        const resource = monitor_type === "dns" ? "v1_dns_monitors" : "v1_http_monitors";
        const result = await client.request({
          method: "GET",
          path: `${BASE_HTTP}/${encodeURIComponent(namespace)}/${resource}/${encodeURIComponent(name)}`,
        });
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
      description: `Create an HTTP/HTTPS synthetic monitor that probes a URL from F5 XC PoP locations or cloud regions.

Probe sources:
  - probe_source: "f5xc" → use F5 XC PoP region names like "ves-io-melbourne", "ves-io-singapore"
  - probe_source: "aws" → use AWS region names like "ap-southeast-1", "us-east-1"
  - probe_source: "gcp" / "azure" → use their respective region names

Key spec fields:
  - url: Full URL including scheme, e.g. "https://www.example.com/health"
  - http_method: "get" (default) or "post"
  - response_codes: List of glob patterns, e.g. ["2**", "3**"] (default)
  - response_timeout_ms: Timeout in milliseconds (default: 10000)
  - interval_minutes: Check interval — 0.5 (30s), 1, 5, 10, 30, or 60 (default: 1)
  - on_failure_count: Consecutive failures before alerting (default: 2)
  - source_critical_threshold: How many sources must fail to trigger alert (default: 1)
  - ignore_cert_errors: Skip TLS certificate validation (default: false)
  - follow_redirects: Follow HTTP redirects (default: false)
  - sni_host: Override SNI hostname for TLS
  - receive: Expected response body substring (empty = any body)
  - request_headers: List of {name, value} header objects`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the monitor"),
        ...MetadataSchema,
        url: z.string().url().describe("Full URL to probe, e.g. https://www.example.com/health"),
        http_method: z.enum(["get", "post"]).default("get").describe("HTTP method to use"),
        response_codes: z.array(z.string()).default(["2**", "3**"]).describe("Expected response code patterns, e.g. [\"2**\", \"3**\"] or [\"200\"]"),
        response_timeout_ms: z.number().int().min(1000).max(60000).default(10000).describe("Response timeout in milliseconds"),
        interval_minutes: z.number().default(1).describe("Check interval: 0.5 (30s), 1, 5, 10, 30, or 60 minutes"),
        on_failure_count: z.number().int().min(1).max(10).default(2).describe("Consecutive failures before alerting"),
        source_critical_threshold: z.number().int().min(1).default(1).describe("Number of probe sources that must fail to trigger alert"),
        ignore_cert_errors: z.boolean().default(false).describe("Skip TLS certificate validation"),
        follow_redirects: z.boolean().default(false).describe("Follow HTTP redirects"),
        sni_host: z.string().optional().describe("Override SNI hostname for TLS connections"),
        receive: z.string().optional().describe("Expected response body substring (empty = any body)"),
        request_headers: z.array(z.object({ name: z.string(), value: z.string() })).optional().describe("HTTP request headers"),
        probe_source: z.enum(["f5xc", "aws", "gcp", "azure"]).default("f5xc").describe("Cloud/PoP provider to send probes from"),
        probe_regions: z.array(z.string()).default(["ves-io-melbourne"]).describe("Probe source regions, e.g. [\"ves-io-melbourne\"] for F5 XC or [\"ap-southeast-1\"] for AWS"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, url, http_method, response_codes, response_timeout_ms, interval_minutes, on_failure_count, source_critical_threshold, ignore_cert_errors, follow_redirects, sni_host, receive, request_headers, probe_source, probe_regions, dryRun }) => {
      try {
        const spec: Record<string, unknown> = {
          url,
          [http_method]: {},
          ...buildInterval(interval_minutes),
          request_headers: request_headers ?? [],
          on_failure_count,
          receive: receive ?? "",
          ignore_cert_errors,
          follow_redirects,
          response_timeout: response_timeout_ms,
          external_sources: buildExternalSources(probe_source, probe_regions),
          source_critical_threshold,
          sni_host: sni_host ?? "",
          response_codes,
          health_policy: {
            dynamic_threshold_disabled: {},
            static_max_threshold_disabled: {},
            static_min_threshold_disabled: {},
          },
        };
        const result = await client.request({
          method: "POST",
          path: `${BASE_HTTP}/${encodeURIComponent(namespace)}/v1_http_monitors`,
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
      description: `Create a DNS synthetic monitor that probes DNS resolution from F5 XC PoP locations or cloud regions.

Key spec fields:
  - domain: Domain name to resolve, e.g. "www.example.com"
  - record_type: "A" (default), "AAAA", "CNAME", "MX", "TXT", "NS"
  - protocol: "TCP" (default) or "UDP"
  - name_servers: Optional list of specific nameserver IPs to query (empty = use system resolvers)
  - lookup_timeout_ms: DNS lookup timeout in milliseconds (default: 5000)
  - interval_minutes: Check interval — 0.5, 1, 5, 10, 30, or 60 minutes (default: 1)
  - on_failure_count: Consecutive failures before alerting (default: 2)
  - probe_source: "f5xc", "aws", "gcp", or "azure"
  - probe_regions: Region names matching the probe_source provider`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the monitor"),
        ...MetadataSchema,
        domain: z.string().min(1).describe("Domain name to resolve, e.g. www.example.com"),
        record_type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS"]).default("A").describe("DNS record type to query"),
        protocol: z.enum(["TCP", "UDP"]).default("TCP").describe("Transport protocol for DNS queries"),
        name_servers: z.array(z.string()).optional().describe("Specific nameserver IPs to query (empty = system resolvers)"),
        lookup_timeout_ms: z.number().int().min(1000).max(30000).default(5000).describe("DNS lookup timeout in milliseconds"),
        interval_minutes: z.number().default(1).describe("Check interval: 0.5 (30s), 1, 5, 10, 30, or 60 minutes"),
        on_failure_count: z.number().int().min(1).max(10).default(2).describe("Consecutive failures before alerting"),
        source_critical_threshold: z.number().int().min(1).default(1).describe("Number of probe sources that must fail to trigger alert"),
        receive: z.string().optional().describe("Expected value in DNS response (empty = any valid response)"),
        probe_source: z.enum(["f5xc", "aws", "gcp", "azure"]).default("f5xc").describe("Cloud/PoP provider to send probes from"),
        probe_regions: z.array(z.string()).default(["ves-io-melbourne"]).describe("Probe source regions"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, domain, record_type, protocol, name_servers, lookup_timeout_ms, interval_minutes, on_failure_count, source_critical_threshold, receive, probe_source, probe_regions, dryRun }) => {
      try {
        const spec: Record<string, unknown> = {
          domain,
          record_type,
          protocol,
          ...buildInterval(interval_minutes),
          on_failure_to_any: {},
          on_failure_count,
          lookup_timeout: lookup_timeout_ms,
          source_critical_threshold,
          name_servers: name_servers ?? [],
          external_sources: buildExternalSources(probe_source, probe_regions),
          receive: receive ?? "",
          health_policy: {
            dynamic_threshold_disabled: {},
            static_max_threshold_disabled: {},
            static_min_threshold_disabled: {},
          },
        };
        const result = await client.request({
          method: "POST",
          path: `${BASE_DNS}/${encodeURIComponent(namespace)}/v1_dns_monitors`,
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
      title: "Update F5 XC Synthetic Monitor",
      description: "Replace a synthetic monitor's full specification (PUT). Retrieve the current spec with xc_get_monitor first, then submit the modified spec.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the monitor"),
        ...MetadataSchema,
        monitor_type: z.enum(["http", "dns"]).default("http").describe("Monitor type: http or dns"),
        spec: z.record(z.unknown()).describe("New complete monitor spec"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, monitor_type, spec, dryRun }) => {
      try {
        const resource = monitor_type === "dns" ? "v1_dns_monitors" : "v1_http_monitors";
        const result = await client.request({
          method: "PUT",
          path: `${BASE_HTTP}/${encodeURIComponent(namespace)}/${resource}/${encodeURIComponent(name)}`,
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
      title: "Delete F5 XC Synthetic Monitor",
      description: "Delete a synthetic monitor (HTTP or DNS). Specify monitor_type to target the correct resource type.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the monitor"),
        name: z.string().min(1).describe("Monitor name to delete"),
        monitor_type: z.enum(["http", "dns"]).default("http").describe("Monitor type: http or dns"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, monitor_type, dryRun }) => {
      try {
        const resource = monitor_type === "dns" ? "v1_dns_monitors" : "v1_http_monitors";
        const result = await client.request({
          method: "DELETE",
          path: `${BASE_HTTP}/${encodeURIComponent(namespace)}/${resource}/${encodeURIComponent(name)}`,
          dryRun,
        });
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
      description: "Delete an alert policy. Ensure no monitors reference it first.",
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
