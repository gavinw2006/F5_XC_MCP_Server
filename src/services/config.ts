import dotenv from "dotenv";
import type { AppConfig } from "../types.js";

dotenv.config();

export function loadConfig(): AppConfig {
  const tenant = process.env.F5_XC_TENANT?.trim() ?? "";
  const baseUrl =
    process.env.F5_XC_BASE_URL?.trim() ||
    (tenant ? `https://${tenant}.console.ves.volterra.io` : "");
  const defaultNamespace = process.env.F5_XC_DEFAULT_NAMESPACE?.trim() || "system";
  const dryRun = (process.env.F5_XC_DRY_RUN?.trim() ?? "true") !== "false";

  return {
    tenant,
    baseUrl,
    apiToken: process.env.F5_XC_API_TOKEN?.trim(),
    defaultNamespace,
    dryRun,
  };
}
