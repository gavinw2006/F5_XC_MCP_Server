import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { F5XcClient, handleApiError } from "../services/f5-xc-client.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, CHARACTER_LIMIT } from "../constants.js";

const PaginationSchema = {
  page_start: z.number().int().min(0).default(0).describe("Pagination offset (number of items to skip)"),
  page_limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Maximum number of items to return"),
};

const DryRunSchema = {
  dryRun: z.boolean().optional().describe("Preview the API call without executing it. Overrides the global F5_XC_DRY_RUN setting."),
};

const MetadataSchema = {
  name: z.string().min(1).max(256).describe("Object name — must be unique within the namespace"),
  description: z.string().optional().describe("Human-readable description"),
  labels: z.record(z.string()).optional().describe("Key-value labels"),
};

function buildMetadata(params: { name: string; namespace?: string; description?: string; labels?: Record<string, string> }): Record<string, unknown> {
  return {
    name: params.name,
    ...(params.namespace ? { namespace: params.namespace } : {}),
    ...(params.description ? { description: params.description } : {}),
    ...(params.labels ? { labels: params.labels } : {}),
  };
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Use page_start/page_limit to paginate.]`;
}

export function registerIdentityTools(server: McpServer, client: F5XcClient, config: AppConfig): void {

  // ── Namespaces ────────────────────────────────────────────────────────────

  server.registerTool(
    "xc_list_namespaces",
    {
      title: "List F5 XC Namespaces",
      description: "List all namespaces in the F5 XC tenant. Returns namespace names, descriptions, and status. Use this to discover available namespaces before managing resources.",
      inputSchema: z.object({ ...PaginationSchema }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: "/api/web/namespaces",
          query: { page_start, page_limit },
        });
        const text = truncate(JSON.stringify(result, null, 2));
        return { content: [{ type: "text", text }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_namespace",
    {
      title: "Get F5 XC Namespace",
      description: "Get details of a specific namespace by name, including its spec and current status.",
      inputSchema: z.object({ name: z.string().min(1).describe("Namespace name") }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/web/namespaces/${encodeURIComponent(name)}` });
        const text = JSON.stringify(result, null, 2);
        return { content: [{ type: "text", text }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_namespace",
    {
      title: "Create F5 XC Namespace",
      description: `Create a new namespace in the F5 XC tenant.

Args:
  - name: Namespace name (lowercase alphanumeric and hyphens, max 64 chars)
  - description: Optional human-readable description
  - dryRun: Preview the call without executing (default: from F5_XC_DRY_RUN env)

Returns the created namespace object, or a dry-run preview.`,
      inputSchema: z.object({ ...MetadataSchema, ...DryRunSchema }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, description, labels, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: "/api/web/namespaces",
          body: { metadata: buildMetadata({ name, description, labels }), spec: {} },
          dryRun,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_delete_namespace",
    {
      title: "Delete F5 XC Namespace",
      description: `Delete a namespace. This is destructive — all objects in the namespace will be removed.

Args:
  - name: Namespace to delete
  - dryRun: Preview the call without executing (default: from F5_XC_DRY_RUN env)`,
      inputSchema: z.object({
        name: z.string().min(1).describe("Namespace name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/web/namespaces/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── User Groups ───────────────────────────────────────────────────────────

  server.registerTool(
    "xc_list_user_groups",
    {
      title: "List F5 XC User Groups",
      description: "List user groups in a namespace. User groups define sets of users with shared namespace/resource access. Defaults to the 'system' namespace where tenant-wide groups are typically managed.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace to list user groups from (default: F5_XC_DEFAULT_NAMESPACE)"),
        ...PaginationSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: `/api/web/namespaces/${encodeURIComponent(namespace)}/user_groups`,
          query: { page_start, page_limit },
        });
        const text = truncate(JSON.stringify(result, null, 2));
        return { content: [{ type: "text", text }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_get_user_group",
    {
      title: "Get F5 XC User Group",
      description: "Get details of a specific user group, including its members and role bindings.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the user group"),
        name: z.string().min(1).describe("User group name"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name }) => {
      try {
        const result = await client.request({ method: "GET", path: `/api/web/namespaces/${encodeURIComponent(namespace)}/user_groups/${encodeURIComponent(name)}` });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  server.registerTool(
    "xc_create_user_group",
    {
      title: "Create F5 XC User Group",
      description: `Create a user group in a namespace. User groups control access to namespaces, objects, and privileges.

Args:
  - namespace: Namespace for the group (usually 'system' for tenant-wide groups)
  - name: Group name
  - description: Optional description
  - spec: Group specification object. Key fields:
      {
        "users": [{"principal": "user@example.com"}],
        "namespace_roles": [{"namespace": "my-ns", "role": "ves-io-admin-role"}]
      }
  - dryRun: Preview without executing

Common role values: ves-io-admin-role, ves-io-operator-role, ves-io-viewer-role`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace for the user group"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("User group spec (users, namespace_roles, etc.)"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: `/api/web/namespaces/${encodeURIComponent(namespace)}/user_groups`,
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
    "xc_update_user_group",
    {
      title: "Update F5 XC User Group",
      description: `Replace a user group's specification (full PUT replace — provide the complete spec).

Args:
  - namespace: Namespace containing the group
  - name: Group name to update
  - spec: New complete group specification
  - dryRun: Preview without executing`,
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the user group"),
        ...MetadataSchema,
        spec: z.record(z.unknown()).describe("New complete user group spec"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ namespace, name, description, labels, spec, dryRun }) => {
      try {
        const result = await client.request({
          method: "PUT",
          path: `/api/web/namespaces/${encodeURIComponent(namespace)}/user_groups/${encodeURIComponent(name)}`,
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
    "xc_delete_user_group",
    {
      title: "Delete F5 XC User Group",
      description: "Delete a user group. Users in the group will lose the associated access rights.",
      inputSchema: z.object({
        namespace: z.string().default(config.defaultNamespace).describe("Namespace containing the user group"),
        name: z.string().min(1).describe("User group name to delete"),
        ...DryRunSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ namespace, name, dryRun }) => {
      try {
        const result = await client.request({ method: "DELETE", path: `/api/web/namespaces/${encodeURIComponent(namespace)}/user_groups/${encodeURIComponent(name)}`, dryRun });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );

  // ── API Credentials ───────────────────────────────────────────────────────

  server.registerTool(
    "xc_list_api_credentials",
    {
      title: "List F5 XC API Credentials",
      description: "List API credentials (tokens and certificates) in the system namespace. Useful for auditing which credentials exist without exposing the actual token values.",
      inputSchema: z.object({ ...PaginationSchema }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ page_start, page_limit }) => {
      try {
        const result = await client.request({
          method: "GET",
          path: "/api/web/namespaces/system/api_credentials",
          query: { page_start, page_limit },
        });
        const text = truncate(JSON.stringify(result, null, 2));
        return { content: [{ type: "text", text }], structuredContent: result as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text", text: handleApiError(err) }] };
      }
    },
  );
}
