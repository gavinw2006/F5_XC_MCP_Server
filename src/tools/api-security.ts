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

export function registerApiSecurityTools(server: McpServer, client: F5XcClient, config: AppConfig): void {

  // ── API Definitions (API Discovery / API Inventory) ───────────────────────

  server.registerTool(
    "xc_list_api_definitions",
    {
      title: "List F5 XC API Definitions",
      description: "List API definitions in a namespace. API definitions are used by API Discovery to learn and inventory API endpoints, and by API Security to enforce endpoint-level policies.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list API definitions from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/api_definitions`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_api_definition",
    {
      title: "Get F5 XC API Definition",
      description: "Get the full specification of an API definition, including the OpenAPI/Swagger schema, endpoint inventory, and discovered API groups.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the API definition"),
        name: z.string().min(1).describe("API definition name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/api_definitions/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_api_definition",
    {
      title: "Create F5 XC API Definition",
      description: `Create an API definition to enable API Discovery and/or API Security on an HTTP load balancer.

Args:
  - namespace: Target namespace
  - name: API definition name
  - spec: API definition spec. Example to enable discovery from traffic learning:
      {
        "swagger_specs": [],
        "learn_from_redirect_traffic": true
      }
  To upload an OpenAPI spec file (base64-encoded):
      {
        "swagger_specs": [{"spec_as_bytes": "<base64-encoded-openapi-json>"}]
      }
  Attach to HTTP LB via the "api_definition" field in the HTTP LB spec.
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the API definition"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("API definition spec (swagger_specs, learning settings, etc.)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/api_definitions`,
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
    "xc_update_api_definition",
    {
      title: "Update F5 XC API Definition",
      description: "Replace an API definition's full specification (PUT). Retrieve the current spec with xc_get_api_definition first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the API definition"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete API definition specification"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/api_definitions/${encodeURIComponent(name)}`,
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
    "xc_delete_api_definition",
    {
      title: "Delete F5 XC API Definition",
      description: "Delete an API definition. Detach it from any HTTP LBs first.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the API definition"),
        name: z.string().min(1).describe("API definition name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/api_definitions/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── App API Groups (API endpoint grouping for security policies) ──────────

  server.registerTool(
    "xc_list_app_api_groups",
    {
      title: "List F5 XC App API Groups",
      description: "List API endpoint groups in a namespace. App API groups define named sets of API endpoints (from an API definition) that can be referenced in service policies for fine-grained API Security controls.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list app API groups from"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_api_groups`,
          query: { page_start, page_limit },
        });
        return { content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_app_api_group",
    {
      title: "Get F5 XC App API Group",
      description: "Get details of an API endpoint group, including which API definition it references and the endpoint patterns it covers.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the app API group"),
        name: z.string().min(1).describe("App API group name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_api_groups/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_app_api_group",
    {
      title: "Create F5 XC App API Group",
      description: `Create an API endpoint group for use in API Security policies.

Args:
  - namespace: Target namespace
  - name: Group name
  - spec: App API group spec. Example:
      {
        "inline_api_group": {
          "elements": [
            {"methods": ["GET","POST"], "path_regex": "/api/v1/users.*"}
          ]
        }
      }
  Or reference an API definition:
      {
        "api_group_ref": {"api_definition_ref": {"name": "my-api-def", "namespace": "my-ns"}}
      }
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the app API group"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("App API group spec (endpoint patterns or API definition reference)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/config/namespaces/${encodeURIComponent(namespace)}/app_api_groups`,
          body: { metadata: buildMetadata({ name, namespace, description, labels }), spec },
          dryRun,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── Raw API Request (escape hatch) ────────────────────────────────────────

  server.registerTool(
    "xc_raw_request",
    {
      title: "F5 XC Raw API Request",
      description: `Send a raw HTTP request to the F5 XC API. Use this for operations not covered by other tools, or to explore the API.

F5 XC API base path examples:
  - /api/web/namespaces — namespace management
  - /api/config/namespaces/{ns}/http_loadbalancers — HTTP LBs
  - /api/config/namespaces/{ns}/origin_pools — origin pools
  - /api/config/namespaces/{ns}/app_firewalls — WAF policies
  - /api/config/namespaces/{ns}/service_policies — service policies
  - /api/config/namespaces/{ns}/api_definitions — API definitions
  - /api/config/namespaces/{ns}/web_app_scanners — Web App Scanning configs

Full API reference: https://docs.cloud.f5.com/docs-v2/api

Args:
  - method: HTTP method
  - path: API path (relative to tenant base URL)
  - body: Request body for POST/PUT
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method"),
        path: z.string().min(1).describe("API path, e.g. /api/web/namespaces"),
        body: z.unknown().optional().describe("Request body for POST/PUT"),
        query: z.record(z.string()).optional().describe("Query string parameters"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ method, path, body, query, dryRun }) => {
      try {
        const result = await client.request({ method, path, body, query, dryRun });
        const text = truncate(JSON.stringify(result, null, 2));
        return { content: [{ type: "text", text }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
