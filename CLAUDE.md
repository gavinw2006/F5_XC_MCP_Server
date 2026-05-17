# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

An MCP (Model Context Protocol) server that acts as an F5 XC expert — ingesting F5 Distributed Cloud documentation and API references, then translating natural language commands into the correct F5 XC API calls to achieve the user's intent.

MCP clients: Claude Code, GitHub Copilot. Deployment targets: Ubuntu VM (AWS, Azure, GCP, Raspberry Pi).

F5 XC API reference: https://docs.cloud.f5.com/docs-v2/api

## Version 1.0 Use Cases

| Use Case | Scope |
|---|---|
| UC-1 | User / Group / Namespace administration — create users, groups, namespaces; assign users to groups; grant access with namespace/resource/privilege scoping |
| UC-2 | HTTP Load Balancer — create, configure, edit, delete |
| UC-3 | WAF & API Protection policies, Bot Defense, DDoS — create, configure, edit, delete |
| UC-4 | API Discovery, API Security, Web Application Scanning, API Security policies — create, configure, edit, delete ✓ Live tested |
| UC-5 | DNS Management — primary and secondary DNS zones (system namespace only), A/CNAME records via `default_rr_set_group`, NS delegation to `ns1/ns2.f5clouddns.com` ✓ Live tested |
| UC-6 | Web Application Scanning (DAST) — separate SaaS API at `app.heyhack.com`, requires `F5_XC_WAS_API_KEY` env var (not the standard XC API token). Findings, scan jobs, recon. |
| UC-7 | DNS Load Balancing / GSLB — `dns_load_balancers`, `dns_lb_pools`, `dns_lb_health_checks` under `/api/config/dns/` base path ✓ Live tested (list) |
| UC-8 | Observability / Synthetic Monitoring — HTTP/DNS health check monitors (`healthchecks`), alert policies (`alert_policys`), alert receivers ✓ Live tested |
| UC-9 | Customer Edge (CE) lifecycle — registration tokens, site list/status/delete, Terraform HCL generation for Azure/AWS/GCP CE deployment ✓ Live tested |

## Architecture (planned)

```
src/
├── server.ts          # MCP server entry — registers tools, resources, prompts
├── client.ts          # CLI client for local testing
├── lib/
│   ├── config.ts      # Env-based config (tenant, API token, namespace, dry-run flag)
│   ├── f5-xc-client.ts    # HTTP client wrapping F5 XC REST API (APIToken auth)
│   ├── operation-catalog.ts   # Loads + queries operation-catalog.json; template renderer
│   ├── docs-index.ts  # File-based doc search (tokenised, scored)
│   ├── intent-parser.ts   # Regex-based NL → tool call mapper
│   └── types.ts       # Shared TypeScript interfaces
└── config/
    ├── operation-catalog.json   # Catalog of F5 XC API operations (verified/draft, risk level)
    └── docs/          # Local F5 XC doc summaries and KB notes (md/txt/json)
```

**Key design constraints:**
- `dryRun` defaults to `true` — all mutating operations must be explicitly confirmed or have `dryRun=false` set
- Operations are marked `verified: true/false` in the catalog; draft operations are blocked unless `allowDraft=true` is passed
- Risk levels (`low` / `medium` / `high`) on every catalog entry — high-risk ops should always prompt confirmation

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `F5_XC_TENANT` | Tenant name (used to build base URL) | — |
| `F5_XC_BASE_URL` | Override base URL | `https://{tenant}.console.ves.volterra.io` |
| `F5_XC_API_TOKEN` | F5 XC API token | — |
| `F5_XC_DEFAULT_NAMESPACE` | Default namespace for operations | `system` |
| `F5_XC_DRY_RUN` | Set to `false` to enable live API calls | `true` |
| `XC_DOCS_DIR` | Path to local docs directory | `./docs` |
| `F5_XC_TF_BIN` | Path to terraform binary | `terraform` (system PATH) |
| `F5_XC_P12_PATH` | Path to `.p12` certificate for Terraform auth | — |
| `F5_XC_P12_PASSWORD` | Password for the `.p12` file | — |
| `F5_XC_WAS_API_KEY` | API key for Web App Scanning (heyhack.com) — separate from XC API token | — |

Store these in a `.env` file (not committed).

## F5 XC API Quirks

### DNS Zones

DNS zones use a **different API base path** — `/api/config/dns/` not `/api/config/`:

```
GET/POST  /api/config/dns/namespaces/system/dns_zones
GET/PUT   /api/config/dns/namespaces/system/dns_zones/{zone-fqdn}
```

- **Zone name must be the FQDN** (e.g. `aidemo.cloud`), not a slug.
- **Only `system` namespace is allowed** — creating in any other namespace returns 400.
- Delegated NS records are in `spec.primary.default_rr_set_group[].ns_record.values` (not a top-level `name_servers` field).

**Adding/editing A records** — records go in `default_rr_set_group` with the hostname in the record's own `name` field. `rr_set_group` with nested `rr_set[]` silently creates empty sets — do not use it for records:

```json
{
  "spec": {
    "primary": {
      "default_rr_set_group": [
        {
          "ttl": 86400,
          "ns_record": { "name": "", "values": ["ns1.f5clouddns.com", "ns2.f5clouddns.com"] },
          "description": ""
        },
        {
          "ttl": 300,
          "a_record": { "name": "demo", "values": ["20.5.122.10"] },
          "description": ""
        },
        {
          "ttl": 300,
          "a_record": { "name": "app", "values": ["1.2.3.4"] },
          "description": ""
        }
      ],
      "rr_set_group": []
    }
  }
}
```

Always include the existing NS entry in `default_rr_set_group` when doing a PUT — omitting it removes the NS records.

### Secondary DNS Zones

Secondary zones use `spec.secondary` instead of `spec.primary`:

```json
{
  "spec": {
    "secondary": {
      "external_primary_servers": [
        {"ip": "203.0.113.1"},
        {"ip": "203.0.113.2"}
      ]
    }
  }
}
```

### Web Application Scanning (UC-6)

**Web App Scanning is a separate SaaS service — NOT the standard F5 XC tenant API.**

- API base URL: `https://app.heyhack.com` (not `console.ves.volterra.io`)
- Authentication: `Authorization: Heyhack <API_KEY>` (not `APIToken`)
- Env var: `F5_XC_WAS_API_KEY` — set separately in `.env`
- Key endpoints:
  - `GET /api/findings` — list vulnerability findings (filter by `?applicationId=<id>`)
  - `POST /api/scanjobs` — start a new DAST scan (`{profileId, applicationId}`)
  - `GET /api/recon/findings` — reconnaissance findings for all jobs
  - `GET /api/recon/{id}/findings` — findings for a specific recon job
  - `GET /api/recon/services` — services discovered by recon jobs
- Swagger docs: `https://app.heyhack.com/swagger`

### DNS Load Balancers (GSLB) (UC-7)

**DNS LBs use `/api/config/dns/` base path — NOT `/api/config/`.**

```
GET/POST  /api/config/dns/namespaces/{ns}/dns_load_balancers
GET/PUT   /api/config/dns/namespaces/{ns}/dns_load_balancers/{name}
GET/POST  /api/config/dns/namespaces/{ns}/dns_lb_pools
GET/POST  /api/config/dns/namespaces/{ns}/dns_lb_health_checks
```

- Distinct from HTTP LBs — resolves at DNS layer, not HTTP.
- Pool priority controls failover: priority 1 pools are tried before priority 2.
- Reference a DNS LB from a DNS zone record to enable GSLB.
- `spec.rule_list` is required and must have at least one rule entry.

### Health Checks / Synthetic Monitoring (UC-8)

- Health checks: `/api/config/namespaces/{ns}/healthchecks`
- **Alert policies quirk**: endpoint spells it `alert_policys` (not `alert_policies`):
  `GET/POST /api/config/namespaces/{ns}/alert_policys`
- Alert receivers (separate notification target objects): `/api/config/namespaces/{ns}/alert_receivers`
- Health check spec quirk: `host_header` and `use_origin_server_name` are **mutually exclusive** — do not set both. Use `host_header` when you want to probe a specific hostname.
- Health check `spec` uses `http_health_check` or `dns_health_check` as the probe type key.
- Monitors are referenced by origin pools for backend health — same objects used for synthetic monitoring.

### Customer Edge Registration (UC-9)

- Registration tokens: `POST /api/register/namespaces/system/tokens`
  - **Quirk**: body must use full metadata wrapper: `{"metadata": {"name": "...", "namespace": "system"}, "spec": {}}` — bare `{"name": "..."}` returns 400.
- CE sites are read-only via REST — CEs self-register: `GET /api/config/namespaces/system/sites`
- Site delete: `DELETE /api/config/namespaces/system/sites/{name}`
- Cloud CE deployment must be done via Terraform using the `volterraedge/volterra` provider.
- Resource types: `volterra_azure_vnet_site`, `volterra_aws_vpc_site`, `volterra_gcp_vpc_site`

### API Security / API Definitions (UC-4)

**LIVE TESTED** against anz-partners tenant with Arcadia Finance OpenAPI 3.0.3 spec (2026-05-17).

- API definitions: `GET/POST /api/config/namespaces/{ns}/api_definitions`
- App API groups: `GET/POST /api/config/namespaces/{ns}/app_api_groups`
- No dedicated update tool for app_api_groups — use `xc_raw_request` with PUT.

**NAMESPACE RESTRICTION**: `api_definitions` (and `app_api_groups`) can only be created in `shared` or an application namespace — **NOT in `system`** (returns 400 with "allowed to be created only in shared or app").

#### Uploading an OpenAPI spec — two-step process

**Step 1**: Upload the spec to the object store (PUT, auto-generates version):
```
PUT /api/object_store/namespaces/{ns}/stored_objects/swagger/{name}
```
Body: `{"namespace": "...", "object_type": "swagger", "name": "...", "bytes_value": "<base64>", "content_format": "json", "no_attributes": {}}`

Response includes the stored object path: `/api/object_store/namespaces/shared/stored_objects/swagger/arcadia-finance/v1-26-05-17`

**Step 2**: Create the API definition referencing the stored object path:
```json
{
  "metadata": {"name": "arcadia-finance", "namespace": "shared"},
  "spec": {
    "swagger_specs": ["/api/object_store/namespaces/shared/stored_objects/swagger/arcadia-finance/v1-26-05-17"]
  }
}
```
`swagger_specs` takes **object store path strings** (not base64 content, not objects with `spec_as_bytes`). The list endpoint is `GET /api/object_store/namespaces/{ns}/stored_objects/swagger` (returns 200). Delete: `DELETE /api/object_store/namespaces/{ns}/stored_objects/swagger/{name}/{version}`.

F5 XC auto-generates the api_groups from the uploaded spec (one group per path+method combination discovered).

**Attaching an API definition to an HTTP LB** — PUT the LB with `spec.api_definition_refs` (array, not `api_definition`):
```json
{
  "spec": {
    "api_definition_refs": [{"name": "arcadia-finance", "namespace": "shared", "tenant": "my-tenant"}],
    "enable_api_discovery": {}
  }
}
```

**Per-path API rate limiting** — PUT the HTTP LB with `spec.api_rate_limit.api_endpoints`:
```json
{
  "spec": {
    "api_rate_limit": {
      "api_endpoints": [
        {
          "http_method": "POST",
          "path": "/trading/rest/buy_stocks.php",
          "inline_rate_limiter": {
            "rate_limiter": {"total_number": 10, "unit": "MINUTE"}
          }
        }
      ]
    }
  }
}
```
`unit` values: `SECOND`, `MINUTE`, `HOUR`.

**App API group — inline endpoints** — use `elements` at the top level of `spec` (NOT nested under `inline_api_group`):
```json
{
  "spec": {
    "elements": [
      {"methods": ["POST"], "path_regex": "/trading/rest/buy_stocks.php"},
      {"methods": ["GET"], "path_regex": "/trading/rest/portfolio.php"}
    ]
  }
}
```
The response includes `api_endpoints_count` confirming how many endpoints were matched.

Live-tested with Arcadia Finance spec (8 endpoints): `/api/lower_bar.php`, `/api/side_bar.php`, `/api/side_bar_accounts.php`, `/trading/rest/portfolio.php`, `/trading/rest/buy_stocks.php`, `/trading/rest/sell_stocks.php`, `/trading/transactions.php`, `/api/rest/execute_money_transfer.php`.

### TCP Load Balancers

- No dedicated MCP tool — use `xc_raw_request` with `POST/PUT /api/config/namespaces/{ns}/tcp_loadbalancers`.
- Use `origin_pools_weights` (not `origin_pools`) for the pool reference array.
- Port ranges are capped at **64 ports per LB** — true all-ports wildcard (like BIG-IP port 0) is not supported.
- Origin pool port must be ≥ 1; to mirror the LB port set origin pool `port` equal to `listen_port`.

## Auto-Documentation Rule

At the end of any session where a new F5 XC API pattern, use case, or resource type was successfully configured via the MCP server, **automatically invoke the `/update-xc-docs` skill** without waiting to be asked. This keeps the use case table, Available Tools section, and API Quirks in sync with what has actually been proven to work.

## Git & Push Rules

- After every change to any file in this repo, **commit the changes and ask the user for permission to push** — do not wait for the user to request it.
- If the user says yes, push immediately to `origin main`.
- If the user says no, leave the commit in place and move on.
- Never push without asking first.
