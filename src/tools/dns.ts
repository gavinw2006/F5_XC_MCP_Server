import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { F5XcClient, handleApiError } from "../services/f5-xc-client.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, CHARACTER_LIMIT } from "../constants.js";

// DNS zones must live in the "system" namespace and use the /api/config/dns/ base path.
// Zone name must be the FQDN (e.g. "example.com"), not a slug.
// Records go in spec.primary.default_rr_set_group — never rr_set_group.
// Always include the existing NS entry on PUT or it is removed.

const DNS_NS = "system";
const DNS_BASE = `/api/config/dns/namespaces/${DNS_NS}/dns_zones`;

const PaginationSchema = {
  page_start: z.number().int().min(0).default(0).describe("Pagination offset"),
  page_limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Max items to return"),
};

const DryRunSchema = {
  dryRun: z.boolean().optional().describe("Preview the API call without executing it"),
};

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Truncated. Use page_start/page_limit to paginate.]`;
}

function buildNsEntry(): Record<string, unknown> {
  return {
    ttl: 86400,
    ns_record: { name: "", values: ["ns1.f5clouddns.com", "ns2.f5clouddns.com"] },
    description: "",
  };
}

export function registerDnsTools(server: McpServer, client: F5XcClient, _config: AppConfig): void {

  // ── DNS Zones ─────────────────────────────────────────────────────────────

  server.registerTool(
    "xc_list_dns_zones",
    {
      title: "List F5 XC DNS Zones",
      description: "List all DNS zones in the system namespace. Returns zone names, delegation NS records, and record counts. DNS zones always live in the system namespace.",
      inputSchema: z.object({
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: DNS_BASE,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_dns_zone",
    {
      title: "Get F5 XC DNS Zone",
      description: "Get the full specification of a DNS zone, including all A, CNAME, MX, NS records in default_rr_set_group.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Zone FQDN (e.g. example.com)"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      try {
        const result = await client.request({ method: "GET", path: `${DNS_BASE}/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_dns_zone",
    {
      title: "Create F5 XC DNS Zone (Primary)",
      description: `Create a primary DNS zone delegated to F5 XC nameservers (ns1/ns2.f5clouddns.com). The NS records are automatically included.

Args:
  - name: Zone FQDN (e.g. example.com) — must be the full domain, not a slug
  - description: Optional human-readable description
  - initial_records: Optional additional records to create alongside the zone. Each entry is a default_rr_set_group element. Example:
      [
        {"ttl": 300, "a_record": {"name": "www", "values": ["1.2.3.4"]}, "description": ""},
        {"ttl": 300, "cname_record": {"name": "blog", "value": "myblog.wpengine.com."}, "description": ""}
      ]
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        name: z.string().min(1).describe("Zone FQDN (e.g. example.com)"),
        description: z.string().optional().describe("Human-readable description"),
        initial_records: z.array(z.record(z.unknown())).optional().describe("Additional DNS records to add at zone creation time"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, description, initial_records, dryRun }) => {
      try {
        const defaultRrSetGroup = [buildNsEntry(), ...(initial_records ?? [])];
        const body: Record<string, unknown> = {
          metadata: { name, namespace: DNS_NS, ...(description ? { description } : {}) },
          spec: {
            primary: {
              default_rr_set_group: defaultRrSetGroup,
              rr_set_group: [],
            },
          },
        };
        const result = await client.request({ method: "POST", path: DNS_BASE, body, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_dns_zone_secondary",
    {
      title: "Create F5 XC DNS Zone (Secondary)",
      description: `Create a secondary DNS zone that transfers from external primary nameservers. F5 XC acts as a secondary resolver — zone data is pulled from your authoritative primaries.

Args:
  - name: Zone FQDN (e.g. example.com)
  - primary_servers: List of external primary nameserver IPs to transfer from. Example: ["203.0.113.1", "203.0.113.2"]
  - description: Optional description
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        name: z.string().min(1).describe("Zone FQDN (e.g. example.com)"),
        primary_servers: z.array(z.string()).min(1).describe("External primary nameserver IP addresses"),
        description: z.string().optional().describe("Human-readable description"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, primary_servers, description, dryRun }) => {
      try {
        const body: Record<string, unknown> = {
          metadata: { name, namespace: DNS_NS, ...(description ? { description } : {}) },
          spec: {
            secondary: {
              external_primary_servers: primary_servers.map((ip) => ({ ip })),
            },
          },
        };
        const result = await client.request({ method: "POST", path: DNS_BASE, body, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_update_dns_zone_records",
    {
      title: "Update F5 XC DNS Zone Records",
      description: `Replace the full record set of a primary DNS zone (PUT). Always include the NS delegation entry or it will be removed.

This is a full replacement — provide ALL records you want, including NS.

Args:
  - name: Zone FQDN
  - records: Complete list of default_rr_set_group entries. MUST include the NS entry:
      {"ttl": 86400, "ns_record": {"name": "", "values": ["ns1.f5clouddns.com", "ns2.f5clouddns.com"]}, "description": ""}
    Plus your A/CNAME/MX records. Example:
      [
        {"ttl": 86400, "ns_record": {"name": "", "values": ["ns1.f5clouddns.com", "ns2.f5clouddns.com"]}, "description": ""},
        {"ttl": 300, "a_record": {"name": "www", "values": ["1.2.3.4"]}, "description": ""},
        {"ttl": 300, "cname_record": {"name": "blog", "value": "myblog.wpengine.com."}, "description": ""}
      ]
  - description: Optional zone description
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        name: z.string().min(1).describe("Zone FQDN (e.g. example.com)"),
        records: z.array(z.record(z.unknown())).min(1).describe("Complete default_rr_set_group array including NS entry"),
        description: z.string().optional().describe("Zone description"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name, records, description, dryRun }) => {
      try {
        const body: Record<string, unknown> = {
          metadata: { name, namespace: DNS_NS, ...(description ? { description } : {}) },
          spec: {
            primary: {
              default_rr_set_group: records,
              rr_set_group: [],
            },
          },
        };
        const result = await client.request({ method: "PUT", path: `${DNS_BASE}/${encodeURIComponent(name)}`, body, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_delete_dns_zone",
    {
      title: "Delete F5 XC DNS Zone",
      description: "Delete a DNS zone and all its records. This cannot be undone — the zone and all DNS records will be removed from F5 XC.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Zone FQDN to delete (e.g. example.com)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `${DNS_BASE}/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
