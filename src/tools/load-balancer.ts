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
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Truncated at ${CHARACTER_LIMIT} chars. Use page_start/page_limit to paginate.]`;
}

export function registerLoadBalancerTools(server: McpServer, client: F5XcClient, config: AppConfig): void {

  // ── Origin Pools ──────────────────────────────────────────────────────────

  server.registerTool(
    "xc_list_origin_pools",
    {
      title: "List F5 XC Origin Pools",
      description: "List origin pools in a namespace. Origin pools define backend server groups used by HTTP load balancers.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list origin pools from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/origin_pools`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_origin_pool",
    {
      title: "Get F5 XC Origin Pool",
      description: "Get the full specification of an origin pool by name, including origin servers, port, health checks, and TLS settings.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the origin pool"),
        name: z.string().min(1).describe("Origin pool name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/origin_pools/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_origin_pool",
    {
      title: "Create F5 XC Origin Pool",
      description: `Create an origin pool defining one or more backend servers.

Args:
  - namespace: Target namespace
  - name: Origin pool name
  - spec: Origin pool spec. Minimal example for a public DNS origin:
      {
        "origin_servers": [{
          "public_name": {"dns_name": "backend.example.com"},
          "labels": {}
        }],
        "port": 443,
        "use_tls": {
          "use_host_header_as_sni": {},
          "volterra_trusted_ca_url": {}
        },
        "loadbalancer_algorithm": "LB_OVERRIDE_ROUND_ROBIN",
        "endpoint_selection": "LOCAL_PREFERRED"
      }
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the origin pool"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("Origin pool specification (origin_servers, port, TLS, health checks, etc.)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/origin_pools`,
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
    "xc_update_origin_pool",
    {
      title: "Update F5 XC Origin Pool",
      description: "Replace an origin pool's full specification (PUT). Provide the complete spec — partial updates are not supported.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the origin pool"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete origin pool specification"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/origin_pools/${encodeURIComponent(name)}`,
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
    "xc_delete_origin_pool",
    {
      title: "Delete F5 XC Origin Pool",
      description: "Delete an origin pool. Fails if any HTTP load balancer still references this pool — remove those references first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the origin pool"),
        name: z.string().min(1).describe("Origin pool name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/origin_pools/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── HTTP Load Balancers ───────────────────────────────────────────────────

  server.registerTool(
    "xc_list_http_lbs",
    {
      title: "List F5 XC HTTP Load Balancers",
      description: "List HTTP load balancers in a namespace. HTTP LBs define domains, routing rules, WAF attachment, Bot Defense, and origin pool references.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list HTTP LBs from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/http_loadbalancers`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_http_lb",
    {
      title: "Get F5 XC HTTP Load Balancer",
      description: "Get the full specification of an HTTP load balancer, including domains, routes, WAF policy, Bot Defense, rate limiting, and origin pool references.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the HTTP LB"),
        name: z.string().min(1).describe("HTTP load balancer name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/http_loadbalancers/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_http_lb",
    {
      title: "Create F5 XC HTTP Load Balancer",
      description: `Create an HTTP load balancer. HTTP LBs handle domain-based routing to origin pools and are the main attachment point for WAF, Bot Defense, API Protection, and DDoS policies.

Args:
  - namespace: Target namespace
  - name: LB name
  - spec: HTTP LB specification. Minimal example:
      {
        "domains": ["app.example.com"],
        "http": {"port": 80},
        "advertise_on_public_default_vip": {},
        "default_route_pools": [{"pool": {"name": "my-origin-pool", "namespace": "my-ns", "tenant": "tenant-id"}, "weight": 1}],
        "disable_waf": {},
        "no_challenge": {},
        "disable_rate_limit": {},
        "round_robin": {},
        "service_policies_from_namespace": {}
      }
  To attach a WAF: replace "disable_waf" with "app_firewall": {"name": "my-waf", "namespace": "my-ns"}
  To enable Bot Defense: add "bot_defense": {"policy": {"name": "my-bot-policy"}}
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the HTTP LB"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("HTTP LB specification (domains, routes, WAF, Bot Defense, origin pools, etc.)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/http_loadbalancers`,
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
    "xc_update_http_lb",
    {
      title: "Update F5 XC HTTP Load Balancer",
      description: "Replace an HTTP load balancer's full specification (PUT). Use xc_get_http_lb first to retrieve the current spec, then modify and provide the complete updated spec.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the HTTP LB"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete HTTP LB specification"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/http_loadbalancers/${encodeURIComponent(name)}`,
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
    "xc_delete_http_lb",
    {
      title: "Delete F5 XC HTTP Load Balancer",
      description: "Delete an HTTP load balancer. This removes all associated domain routing and security policy attachments. The referenced origin pools are NOT deleted.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the HTTP LB"),
        name: z.string().min(1).describe("HTTP load balancer name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/http_loadbalancers/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
