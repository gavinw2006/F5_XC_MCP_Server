import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AppConfig } from "../types.js";

const execFileAsync = promisify(execFile);

export interface TfRunResult {
  stdout: string;
  stderr: string;
  success: boolean;
  command: string;
}

export class TerraformRunner {
  private readonly config: AppConfig;
  readonly tfBin: string;

  constructor(config: AppConfig) {
    this.config = config;
    this.tfBin = config.tfBin ?? "terraform";
  }

  isAuthConfigured(): boolean {
    return !!(
      (this.config.certPath && this.config.keyPath) ||
      this.config.p12Path
    );
  }

  generateProviderHcl(): string {
    const tenantUrl = this.config.baseUrl
      ? `${this.config.baseUrl}/api`
      : this.config.tenant
        ? `https://${this.config.tenant}.console.ves.volterra.io/api`
        : "https://<tenant>.console.ves.volterra.io/api";

    let authLines: string;
    if (this.config.certPath && this.config.keyPath) {
      authLines = `  api_cert = "${this.config.certPath}"\n  api_key  = "${this.config.keyPath}"`;
    } else if (this.config.p12Path) {
      authLines = `  api_p12_file = "${this.config.p12Path}"`;
    } else {
      authLines = `  # No cert auth configured.\n  # Set F5_XC_CERT_PATH + F5_XC_KEY_PATH (PEM) or F5_XC_P12_PATH in .env`;
    }

    return `terraform {
  required_providers {
    volterra = {
      source  = "volterraedge/volterra"
      version = "~> 0.11"
    }
  }
}

provider "volterra" {
  url = "${tenantUrl}"
${authLines}
}
`;
  }

  generateResourceHcl(resourceType: string, resourceLabel: string, attrs: Record<string, unknown>): string {
    return `resource "${resourceType}" "${resourceLabel}" {\n${this.attrsToHcl(attrs, 2)}}\n`;
  }

  private attrsToHcl(obj: Record<string, unknown>, indent: number): string {
    const pad = " ".repeat(indent);
    let out = "";
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string") {
        out += `${pad}${key} = "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n`;
      } else if (typeof value === "number" || typeof value === "boolean") {
        out += `${pad}${key} = ${value}\n`;
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            out += `${pad}${key} {\n${this.attrsToHcl(item as Record<string, unknown>, indent + 2)}${pad}}\n`;
          } else {
            out += `${pad}${key} = ${JSON.stringify(item)}\n`;
          }
        }
      } else if (typeof value === "object") {
        out += `${pad}${key} {\n${this.attrsToHcl(value as Record<string, unknown>, indent + 2)}${pad}}\n`;
      }
    }
    return out;
  }

  async runHcl(hcl: string, command: "plan" | "apply" | "destroy", autoApprove = false): Promise<TfRunResult> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "xc-tf-"));
    try {
      await fs.writeFile(path.join(tmpDir, "main.tf"), hcl, "utf8");

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TF_IN_AUTOMATION: "1",
        TF_CLI_ARGS_init: "-no-color -input=false",
        ...(this.config.p12Password ? { VES_P12_PASSWORD: this.config.p12Password } : {}),
      };

      try {
        await execFileAsync(this.tfBin, ["init", "-no-color", "-input=false"], { cwd: tmpDir, env });
      } catch (initErr: unknown) {
        const e = initErr as { stdout?: string; stderr?: string; message?: string };
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(initErr), success: false, command: "init" };
      }

      const args = [command, "-no-color", "-input=false"];
      if ((command === "apply" || command === "destroy") && autoApprove) args.push("-auto-approve");

      try {
        const { stdout, stderr } = await execFileAsync(this.tfBin, args, { cwd: tmpDir, env, timeout: 120_000 });
        return { stdout, stderr, success: true, command };
      } catch (runErr: unknown) {
        const e = runErr as { stdout?: string; stderr?: string; message?: string };
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(runErr), success: false, command };
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}

// ── Known Volterra resource type mapping ─────────────────────────────────────

export const VOLTERRA_RESOURCE_TYPES: Record<string, string> = {
  namespace:           "volterra_namespace",
  user_group:          "volterra_user_group",
  http_loadbalancer:   "volterra_http_loadbalancer",
  origin_pool:         "volterra_origin_pool",
  app_firewall:        "volterra_app_firewall",
  service_policy:      "volterra_service_policy",
  api_definition:      "volterra_api_definition",
  app_api_group:       "volterra_app_api_group",
  virtual_network:     "volterra_virtual_network",
  virtual_host:        "volterra_virtual_host",
  healthcheck:         "volterra_healthcheck",
};
