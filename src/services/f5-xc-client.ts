import axios, { type AxiosInstance } from "axios";
import type { AppConfig, RequestOptions } from "../types.js";
import { REQUEST_TIMEOUT_MS } from "../constants.js";

export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | undefined;
    const detail = (data?.message ?? data?.error_code ?? data?.error ?? error.message) as string;
    switch (status) {
      case 400: return `Error: Bad request — ${detail}. Check the request body and parameters.`;
      case 401: return "Error: Authentication failed. Verify F5_XC_API_TOKEN is set and valid.";
      case 403: return "Error: Permission denied. Your API token may lack the required role/namespace access.";
      case 404: return "Error: Resource not found. Check the name, namespace, and tenant.";
      case 409: return `Error: Conflict — ${detail}. The resource may already exist.`;
      case 429: return "Error: Rate limit exceeded. Wait a moment before retrying.";
      case 500: return `Error: F5 XC internal server error — ${detail}.`;
      default:  return `Error: API request failed (HTTP ${status ?? "no response"}) — ${detail}`;
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

export class F5XcClient {
  private readonly http: AxiosInstance;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.baseUrl || "https://dry-run.local",
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(config.apiToken ? { Authorization: `APIToken ${config.apiToken}` } : {}),
      },
    });
  }

  async request(options: RequestOptions): Promise<unknown> {
    const dryRun = options.dryRun ?? this.config.dryRun;

    if (dryRun) {
      const base = this.config.baseUrl || "https://dry-run.local";
      const url = new URL(options.path, base);
      for (const [k, v] of Object.entries(options.query ?? {})) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
      return { dryRun: true, method: options.method, url: url.toString(), body: options.body ?? null };
    }

    if (!this.config.baseUrl) throw new Error("F5_XC_BASE_URL (or F5_XC_TENANT) is not configured.");
    if (!this.config.apiToken) throw new Error("F5_XC_API_TOKEN is not configured.");

    const response = await this.http.request({
      method: options.method,
      url: options.path,
      data: options.body,
      params: options.query,
    });

    return response.data;
  }
}
