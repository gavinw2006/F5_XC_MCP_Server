import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { F5XcClient, handleApiError } from "../services/f5-xc-client.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, CHARACTER_LIMIT } from "../constants.js";

// DNS Load Balancers (GSLB) in F5 XC route DNS queries to origin pools based on
// geographic proximity, weighted round-robin, or failover policies.
// API base path: /api/config/dns/namespaces/{ns}/ (NOT /api/config/namespaces/{ns}/)
// Resources: dns_load_balancers, dns_lb_pools, dns_lb_health_checks
// Note: DNS LBs are distinct from HTTP LBs. They resolve at the DNS layer, not HTTP.

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

export function registerDnsLbTools(server: McpServer, client: F5XcClient, config: AppConfig): void {

  // ── DNS Load Balancers (GSLB) ─────────────────────────────────────────────

  server.registerTool(
    "xc_list_dns_lbs",
    {
      title: "List F5 XC DNS Load Balancers (GSLB)",
      description: "List DNS load balancers in a namespace. DNS LBs perform Global Server Load Balancing — they return different IP addresses based on geographic proximity, health, or weight. Used with DNS zones to implement GSLB.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list DNS LBs from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/dns/namespaces/${encodeURIComponent(namespace)}/dns_load_balancers`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_dns_lb",
    {
      title: "Get F5 XC DNS Load Balancer (GSLB)",
      description: "Get the full specification of a DNS load balancer, including pools, health checks, routing policy, and geographic rules.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the DNS LB"),
        name: z.string().min(1).describe("DNS load balancer name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/dns/namespaces/${encodeURIComponent(namespace)}/dns_load_balancers/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_dns_lb",
    {
      title: "Create F5 XC DNS Load Balancer (GSLB)",
      description: `Create a DNS load balancer for Global Server Load Balancing. Returns different IP addresses to DNS queries based on health, proximity, or weight.

To use a DNS LB: create it, then reference it in a DNS zone record via a pool record type.

Args:
  - namespace: Target namespace
  - name: DNS LB name
  - spec: DNS LB specification. Example for weighted round-robin between two pools:
      {
        "dns_lb_pools": [
          {
            "pool": {"name": "us-east-pool", "namespace": "my-ns", "tenant": ""},
            "weight": 80,
            "priority": 1
          },
          {
            "pool": {"name": "us-west-pool", "namespace": "my-ns", "tenant": ""},
            "weight": 20,
            "priority": 1
          }
        ],
        "health_check_port": 443,
        "ttl": 30,
        "enable_probing": {}
      }
    For geographic routing (nearest endpoint):
      {
        "dns_lb_pools": [...],
        "geo_proximity_route": {},
        "ttl": 30
      }
    For failover (primary/backup):
      {
        "dns_lb_pools": [
          {"pool": {"name": "primary"}, "weight": 1, "priority": 1},
          {"pool": {"name": "backup"}, "weight": 1, "priority": 2}
        ],
        "ttl": 30
      }
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the DNS LB"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("DNS LB spec (dns_lb_pools, ttl, routing policy, health checks)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/dns/namespaces/${encodeURIComponent(namespace)}/dns_load_balancers`,
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
    "xc_update_dns_lb",
    {
      title: "Update F5 XC DNS Load Balancer (GSLB)",
      description: "Replace a DNS load balancer's full specification (PUT). Retrieve the current spec with xc_get_dns_lb first. Use to change pool weights, routing policy, TTL, or health check settings.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the DNS LB"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete DNS LB specification"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/config/dns/namespaces/${encodeURIComponent(namespace)}/dns_load_balancers/${encodeURIComponent(name)}`,
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
    "xc_delete_dns_lb",
    {
      title: "Delete F5 XC DNS Load Balancer (GSLB)",
      description: "Delete a DNS load balancer. Remove any DNS zone records that reference this LB first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the DNS LB"),
        name: z.string().min(1).describe("DNS load balancer name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/dns/namespaces/${encodeURIComponent(namespace)}/dns_load_balancers/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
