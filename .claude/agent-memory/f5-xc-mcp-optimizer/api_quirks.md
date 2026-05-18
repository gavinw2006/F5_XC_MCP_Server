---
name: F5 XC API quirks discovered
description: API path patterns, payload shapes, and gotchas validated or inferred from documentation and codebase
type: project
---

## API Security / API Definitions (UC-4) — LIVE TESTED 2026-05-17

- API definitions: `GET/POST /api/config/namespaces/{ns}/api_definitions`
- App API groups: `GET/POST /api/config/namespaces/{ns}/app_api_groups`
- **NAMESPACE**: api_definitions can ONLY be created in `shared` or app ns — NOT `system` (returns 400)
- **OpenAPI upload is a TWO-STEP process:**
  1. PUT `/api/object_store/namespaces/{ns}/stored_objects/swagger/{name}` with body `{namespace, object_type: "swagger", name, bytes_value: "<base64>", content_format: "json", no_attributes: {}}` — response has metadata.url with auto-generated version
  2. POST api_definition with `spec.swagger_specs: ["<stored-object-path>"]` — paths are strings, NOT objects with spec_as_bytes
- List swagger specs: `GET /api/object_store/namespaces/{ns}/stored_objects/swagger` (returns 200)
- Delete swagger spec: `DELETE /api/object_store/namespaces/{ns}/stored_objects/swagger/{name}/{version}`
- Attach API definition to HTTP LB: use `spec.api_definition_refs` (array, NOT `spec.api_definition`) plus `spec.enable_api_discovery: {}`
- Per-path rate limiting: `spec.api_rate_limit.api_endpoints[].inline_rate_limiter.rate_limiter.{total_number, unit}` — unit: SECOND/MINUTE/HOUR
- **App API group inline elements**: `spec.elements[].{methods, path_regex}` — elements is at spec ROOT, NOT under `inline_api_group`
- No dedicated PUT tool for app_api_groups — use xc_raw_request
- F5 XC auto-generates api_groups from uploaded spec (one group per discovered path+method)

## DNS Zones (UC-5)
- Base path: `/api/config/dns/namespaces/system/dns_zones` (NOT /api/config/)
- Zone name must be FQDN (e.g. example.com), not a slug
- Only `system` namespace is allowed — any other namespace returns 400
- Records in `spec.primary.default_rr_set_group` — never `rr_set_group`
- NS entry must always be present on PUT or it is removed
- Secondary zones use `spec.secondary.external_primary_servers: [{ip: "..."}]`

## Web App Scanning (UC-6)
- API path: `/api/config/namespaces/{ns}/web_app_scanners`
- Attach to HTTP LB via `spec.web_app_scanner.web_app_scanner_ref` (array of object refs with name/namespace/tenant)
- xc_scan_enable_on_lb does GET+PUT to inject the ref into existing LB spec

## DNS LB / GSLB (UC-7)
- API path: `/api/config/namespaces/{ns}/dns_load_balancers`
- Distinct from HTTP LBs — DNS-layer routing
- Pool priority: priority 1 is tried before priority 2 (failover)
- Must reference pools by name/namespace/tenant object ref

## Synthetic Monitors / Observability (UC-8) — LIVE TESTED 2026-05-18

**CRITICAL**: Synthetic monitors use a DIFFERENT API than origin pool health checks.

- HTTP synthetic monitors: `GET/POST /api/observability/synthetic_monitor/namespaces/{ns}/v1_http_monitors`
- DNS synthetic monitors: `GET/POST /api/observability/synthetic_monitor/namespaces/{ns}/v1_dns_monitors`
- GET/PUT/DELETE individual: `…/{resource}/{name}`
- Origin pool health checks (NOT synthetic monitors): `/api/config/namespaces/{ns}/healthchecks`
- Alert policies (quirk: spells "alert_policys"): `/api/config/namespaces/{ns}/alert_policys`
- Alert receivers: `/api/config/namespaces/{ns}/alert_receivers`

HTTP monitor spec keys:
- `url`: full URL including scheme
- `get: {}` or `post: {}` — HTTP method (oneOf)
- `interval_1_min: {}` (or interval_30_sec, interval_5_min, etc.) — check interval (oneOf)
- `response_timeout`: in milliseconds (NOT seconds)
- `external_sources: [{provider: {regions: [...]}}]` — provider: f5xc, aws, gcp, azure
- F5 XC PoP regions use `ves-io-` prefix: `ves-io-melbourne`, `ves-io-singapore`, etc.
- `response_codes: ["2**", "3**"]` — glob patterns

DNS monitor spec keys:
- `domain`, `record_type` (A/AAAA/CNAME/MX/TXT/NS), `protocol` (TCP/UDP)
- `lookup_timeout`: in milliseconds
- `name_servers: []` — empty = use system resolvers
- `on_failure_to_any: {}` or `on_failure_to_all: {}` — failure routing (oneOf)

## Customer Edge (UC-9)
- Registration tokens: POST `/api/register/namespaces/system/tokens` body: `{"name": "label"}`
- Site read: GET `/api/config/namespaces/system/sites` (CE self-registers, REST is read-only for site object)
- Site delete: DELETE `/api/config/namespaces/system/sites/{name}`
- Cloud deployment requires Terraform: volterraedge/volterra provider
  - Azure: volterra_azure_vnet_site
  - AWS: volterra_aws_vpc_site
  - GCP: volterra_gcp_vpc_site

**Why:** Documented as reference for future sessions to avoid re-researching these patterns.

**How to apply:** Always check here before writing new API calls in these domains.
