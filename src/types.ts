export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AppConfig {
  tenant: string;
  baseUrl: string;
  apiToken?: string;
  certPath?: string;
  keyPath?: string;
  defaultNamespace: string;
  dryRun: boolean;
  // Terraform fallback
  tfBin?: string;
  p12Path?: string;
  p12Password?: string;
}

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  dryRun?: boolean;
}

export interface XcMetadata {
  name: string;
  namespace?: string;
  description?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface XcObject {
  metadata: XcMetadata;
  spec: Record<string, unknown>;
  status?: Record<string, unknown>;
}

export interface XcListResponse {
  items?: XcObject[];
  metadata?: { total_count?: number };
}
