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
    certPath: process.env.F5_XC_CERT_PATH?.trim(),
    keyPath: process.env.F5_XC_KEY_PATH?.trim(),
    defaultNamespace,
    dryRun,
    tfBin: process.env.F5_XC_TF_BIN?.trim(),
    p12Path: process.env.F5_XC_P12_PATH?.trim(),
    p12Password: process.env.F5_XC_P12_PASSWORD?.trim(),
  };
}
