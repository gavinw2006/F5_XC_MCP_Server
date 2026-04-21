import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../types.js";
import { TerraformRunner, VOLTERRA_RESOURCE_TYPES } from "../services/terraform-runner.js";

const RESOURCE_TYPE_ENUM = Object.keys(VOLTERRA_RESOURCE_TYPES) as [string, ...string[]];

export function registerTerraformTools(server: McpServer, tf: TerraformRunner, config: AppConfig): void {

  // ── xc_tf_generate_hcl ────────────────────────────────────────────────────

  server.registerTool(
    "xc_tf_generate_hcl",
    {
      title: "Generate F5 XC Terraform HCL",
      description: `Generate Terraform HCL for an F5 XC resource using the volterraedge/volterra provider.
This is read-only — it only generates text, it does NOT apply anything.

Supported resource types: ${RESOURCE_TYPE_ENUM.join(", ")}

Args:
  - resource_type: F5 XC resource type (e.g. "namespace", "http_loadbalancer", "user_group")
  - name: Terraform resource label (also used as the 'name' attribute if not in attrs)
  - namespace: Namespace for the resource (added to attrs automatically if provided)
  - attrs: Additional HCL attributes as a JSON object (e.g. {"description": "my ns"})
  - include_provider: Include the provider block (default: true). Set to false for modules.

Example attrs for user_group:
  {"namespace_roles": [{"namespace": "test-namespace", "role": "ves-io-admin-role"}]}

Example attrs for http_loadbalancer:
  {"namespace": "default", "domains": ["example.com"], "http": {}}`,
      inputSchema: z.object({
        resource_type: z.enum(RESOURCE_TYPE_ENUM).describe("F5 XC resource type"),
        name: z.string().min(1).describe("Resource name (and Terraform label)"),
        namespace: z.string().optional().describe("Namespace for the resource (added automatically)"),
        attrs: z.record(z.unknown()).optional().describe("Additional HCL attributes as JSON"),
        include_provider: z.boolean().default(true).describe("Include provider block in output"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ resource_type, name, namespace, attrs, include_provider }) => {
      const tfType = VOLTERRA_RESOURCE_TYPES[resource_type];
      const tfLabel = name.replace(/[^a-zA-Z0-9_]/g, "_");

      const resourceAttrs: Record<string, unknown> = {
        name,
        ...(namespace ? { namespace } : {}),
        ...(attrs ?? {}),
      };

      let hcl = "";
      if (include_provider) hcl += tf.generateProviderHcl() + "\n";
      hcl += tf.generateResourceHcl(tfType, tfLabel, resourceAttrs);

      const authWarning = !tf.isAuthConfigured()
        ? "\n# NOTE: Terraform auth is not configured.\n# Set F5_XC_CERT_PATH + F5_XC_KEY_PATH (PEM) or F5_XC_P12_PATH + F5_XC_P12_PASSWORD in .env"
        : "";

      return {
        content: [{ type: "text", text: authWarning ? hcl + authWarning : hcl }],
        structuredContent: { hcl, tfType, tfLabel, authConfigured: tf.isAuthConfigured() },
      };
    },
  );

  // ── xc_tf_plan ────────────────────────────────────────────────────────────

  server.registerTool(
    "xc_tf_plan",
    {
      title: "Terraform Plan for F5 XC Resource",
      description: `Run 'terraform plan' for an F5 XC resource using the volterraedge/volterra provider.
This is safe — plan does NOT make any changes. Shows what would be created/modified/destroyed.

Requires:
  - terraform binary on PATH (or set F5_XC_TF_BIN env var)
  - Auth: F5_XC_CERT_PATH + F5_XC_KEY_PATH (PEM files) OR F5_XC_P12_PATH + F5_XC_P12_PASSWORD

If you only have the HCL already generated, pass it directly as 'hcl'.
Otherwise, provide resource_type + name + attrs to auto-generate.`,
      inputSchema: z.object({
        hcl: z.string().optional().describe("Full Terraform HCL to plan (including provider block). If omitted, provide resource_type + name + attrs."),
        resource_type: z.enum(RESOURCE_TYPE_ENUM).optional().describe("F5 XC resource type (used if hcl is not provided)"),
        name: z.string().optional().describe("Resource name (used if hcl is not provided)"),
        namespace: z.string().optional().describe("Namespace (used if hcl is not provided)"),
        attrs: z.record(z.unknown()).optional().describe("Additional attributes (used if hcl is not provided)"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ hcl, resource_type, name, namespace, attrs }) => {
      let planHcl = hcl;
      if (!planHcl) {
        if (!resource_type || !name) {
          return { content: [{ type: "text", text: "Error: provide either 'hcl' or both 'resource_type' and 'name'." }] };
        }
        const tfType = VOLTERRA_RESOURCE_TYPES[resource_type];
        const tfLabel = name.replace(/[^a-zA-Z0-9_]/g, "_");
        const resourceAttrs: Record<string, unknown> = { name, ...(namespace ? { namespace } : {}), ...(attrs ?? {}) };
        planHcl = tf.generateProviderHcl() + "\n" + tf.generateResourceHcl(tfType, tfLabel, resourceAttrs);
      }

      if (!tf.isAuthConfigured() && !config.dryRun) {
        return {
          content: [{
            type: "text",
            text: `Cannot run terraform plan: no cert auth configured.\nSet F5_XC_CERT_PATH + F5_XC_KEY_PATH or F5_XC_P12_PATH + F5_XC_P12_PASSWORD in .env.\n\nGenerated HCL:\n\`\`\`hcl\n${planHcl}\`\`\``,
          }],
        };
      }

      if (config.dryRun) {
        return {
          content: [{
            type: "text",
            text: `DRY-RUN MODE: terraform plan skipped.\n\nGenerated HCL that would be planned:\n\`\`\`hcl\n${planHcl}\`\`\``,
          }],
        };
      }

      const result = await tf.runHcl(planHcl, "plan");
      const summary = result.success ? "✓ Plan succeeded" : "✗ Plan failed";
      const output = [summary, result.stdout, result.stderr ? `STDERR:\n${result.stderr}` : ""].filter(Boolean).join("\n\n");
      return { content: [{ type: "text", text: output }] };
    },
  );

  // ── xc_tf_apply ───────────────────────────────────────────────────────────

  server.registerTool(
    "xc_tf_apply",
    {
      title: "Terraform Apply for F5 XC Resource",
      description: `Run 'terraform apply' to create or update an F5 XC resource.
Uses the volterraedge/volterra provider. Each apply runs in a fresh temp directory (stateless).

IMPORTANT: This makes LIVE changes to F5 XC unless dryRun=true.
In dryRun mode, runs 'terraform plan' instead of 'terraform apply'.

Requires:
  - terraform binary on PATH (or set F5_XC_TF_BIN env var)
  - Auth: F5_XC_CERT_PATH + F5_XC_KEY_PATH (PEM files) OR F5_XC_P12_PATH + F5_XC_P12_PASSWORD

If you only have the HCL, pass it directly. Otherwise provide resource_type + name + attrs.

Common use cases:
  - Create a namespace: resource_type="namespace", name="my-ns"
  - Create user group with roles: resource_type="user_group", attrs={"namespace_roles": [...]}
  - Create HTTP LB: resource_type="http_loadbalancer", attrs={"domains":["x.com"], ...}`,
      inputSchema: z.object({
        hcl: z.string().optional().describe("Full Terraform HCL (including provider block). If omitted, auto-generated from resource_type + name + attrs."),
        resource_type: z.enum(RESOURCE_TYPE_ENUM).optional().describe("F5 XC resource type (used if hcl not provided)"),
        name: z.string().optional().describe("Resource name (used if hcl not provided)"),
        namespace: z.string().optional().describe("Namespace (used if hcl not provided)"),
        attrs: z.record(z.unknown()).optional().describe("Additional HCL attributes (used if hcl not provided)"),
        dryRun: z.boolean().optional().describe("Run plan instead of apply (preview). Overrides global F5_XC_DRY_RUN."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ hcl, resource_type, name, namespace, attrs, dryRun }) => {
      let applyHcl = hcl;
      if (!applyHcl) {
        if (!resource_type || !name) {
          return { content: [{ type: "text", text: "Error: provide either 'hcl' or both 'resource_type' and 'name'." }] };
        }
        const tfType = VOLTERRA_RESOURCE_TYPES[resource_type];
        const tfLabel = name.replace(/[^a-zA-Z0-9_]/g, "_");
        const resourceAttrs: Record<string, unknown> = { name, ...(namespace ? { namespace } : {}), ...(attrs ?? {}) };
        applyHcl = tf.generateProviderHcl() + "\n" + tf.generateResourceHcl(tfType, tfLabel, resourceAttrs);
      }

      const effectiveDryRun = dryRun ?? config.dryRun;

      if (!tf.isAuthConfigured()) {
        return {
          content: [{
            type: "text",
            text: `Cannot run terraform: no cert auth configured.\nSet F5_XC_CERT_PATH + F5_XC_KEY_PATH or F5_XC_P12_PATH + F5_XC_P12_PASSWORD in .env.\n\nHCL that would be applied:\n\`\`\`hcl\n${applyHcl}\`\`\``,
          }],
        };
      }

      const command = effectiveDryRun ? "plan" : "apply";
      const result = await tf.runHcl(applyHcl, command, !effectiveDryRun);

      const label = effectiveDryRun ? "PLAN (dry-run)" : "APPLY";
      const symbol = result.success ? "✓" : "✗";
      const output = [`${symbol} terraform ${command} — ${label}`, result.stdout, result.stderr ? `STDERR:\n${result.stderr}` : ""].filter(Boolean).join("\n\n");
      return { content: [{ type: "text", text: output }] };
    },
  );

  // ── xc_tf_destroy ─────────────────────────────────────────────────────────

  server.registerTool(
    "xc_tf_destroy",
    {
      title: "Terraform Destroy F5 XC Resource",
      description: `Run 'terraform destroy' to delete an F5 XC resource via the volterra provider.
DESTRUCTIVE — this deletes the resource from F5 XC.
In dryRun mode, runs 'terraform plan -destroy' instead.

Requires the same HCL/resource_type+name that was used to create the resource.`,
      inputSchema: z.object({
        hcl: z.string().optional().describe("Full HCL of the resource to destroy"),
        resource_type: z.enum(RESOURCE_TYPE_ENUM).optional().describe("F5 XC resource type"),
        name: z.string().optional().describe("Resource name"),
        namespace: z.string().optional().describe("Namespace"),
        attrs: z.record(z.unknown()).optional().describe("Additional attributes"),
        dryRun: z.boolean().optional().describe("Plan-destroy only (no actual deletion)"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ hcl, resource_type, name, namespace, attrs, dryRun }) => {
      let destroyHcl = hcl;
      if (!destroyHcl) {
        if (!resource_type || !name) {
          return { content: [{ type: "text", text: "Error: provide either 'hcl' or both 'resource_type' and 'name'." }] };
        }
        const tfType = VOLTERRA_RESOURCE_TYPES[resource_type];
        const tfLabel = name.replace(/[^a-zA-Z0-9_]/g, "_");
        const resourceAttrs: Record<string, unknown> = { name, ...(namespace ? { namespace } : {}), ...(attrs ?? {}) };
        destroyHcl = tf.generateProviderHcl() + "\n" + tf.generateResourceHcl(tfType, tfLabel, resourceAttrs);
      }

      const effectiveDryRun = dryRun ?? config.dryRun;

      if (!tf.isAuthConfigured()) {
        return {
          content: [{
            type: "text",
            text: `Cannot run terraform: no cert auth configured.\nSet F5_XC_CERT_PATH + F5_XC_KEY_PATH or F5_XC_P12_PATH + F5_XC_P12_PASSWORD in .env.\n\nHCL that would be destroyed:\n\`\`\`hcl\n${destroyHcl}\`\`\``,
          }],
        };
      }

      const command = effectiveDryRun ? "plan" : "destroy";
      const extraArgs = effectiveDryRun ? ["-destroy"] : [];
      const result = await tf.runHcl(destroyHcl, effectiveDryRun ? "plan" : "destroy", !effectiveDryRun);
      void extraArgs;

      const label = effectiveDryRun ? "PLAN-DESTROY (dry-run)" : "DESTROY";
      const symbol = result.success ? "✓" : "✗";
      const output = [`${symbol} terraform ${command} — ${label}`, result.stdout, result.stderr ? `STDERR:\n${result.stderr}` : ""].filter(Boolean).join("\n\n");
      return { content: [{ type: "text", text: output }] };
    },
  );
}
