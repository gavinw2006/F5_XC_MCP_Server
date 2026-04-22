# Changelog

All notable changes to the F5 XC MCP Server are documented here.

---

## [Unreleased]

### Deployment
- MCP server now exposed via HTTPS at `https://mcp.xcdemo.site/mcp`
- Caddy 2.11.2 installed as TLS-terminating reverse proxy on the Azure VM
- Let's Encrypt certificate auto-provisioned via ACME HTTP-01 challenge
- Azure NSG rules added for ports 80 (ACME) and 443 (HTTPS)
- Caddy proxy timeout set to 90s to handle slow F5 XC API responses

---

## [1.2.0] — 2026-04-22

### Added — Terraform Fallback
- New `TerraformRunner` service (`src/services/terraform-runner.ts`):
  - Generates Terraform HCL for the `volterraedge/volterra` provider
  - Runs `terraform init / plan / apply / destroy` in isolated temp directories
  - Supports both PEM cert+key and `.p12` file for provider authentication
- Four new MCP tools:
  - `xc_tf_generate_hcl` — generate HCL for any F5 XC resource (read-only)
  - `xc_tf_plan` — run `terraform plan` as a safe preview
  - `xc_tf_apply` — apply Terraform configuration (respects `dryRun`)
  - `xc_tf_destroy` — destroy a resource via Terraform
- Supported Terraform resource types: `namespace`, `user_group`, `http_loadbalancer`, `origin_pool`, `app_firewall`, `service_policy`, `api_definition`, `app_api_group`, `virtual_network`, `virtual_host`, `healthcheck`
- Identity write tools (`xc_create_user_group`, `xc_update_user_group`, `xc_delete_user_group`) now automatically append Terraform HCL fallback in the error response when the F5 XC REST API returns an error (the REST API does not support user group write operations)
- `xc_server_status` now reports Terraform auth status alongside REST auth status

### Changed
- `AppConfig` extended with `tfBin`, `p12Path`, `p12Password` fields
- `loadConfig()` reads three new env vars: `F5_XC_TF_BIN`, `F5_XC_P12_PATH`, `F5_XC_P12_PASSWORD`

---

## [1.1.0] — 2026-04-21

### Added — mTLS Certificate Authentication
- `F5XcClient` now supports mTLS via `https.Agent` with PEM cert and key
- New env vars: `F5_XC_CERT_PATH`, `F5_XC_KEY_PATH`
- `buildHttpsAgent()` helper in `f5-xc-client.ts`
- `xc_server_status` reports auth method as `certificate (mTLS)` or `API token`
- `AppConfig` extended with `certPath` and `keyPath` fields

### Changed
- Auth method selection: certificate takes priority over API token when both are configured

---

## [1.0.0] — 2026-04-21

### Initial Release

#### Architecture
- TypeScript MCP server using `@modelcontextprotocol/sdk` v1.6.1
- Dual transport: `stdio` (local, for Claude Code / GitHub Copilot) and streamable HTTP (remote, port 3000)
- Dry-run mode on by default (`F5_XC_DRY_RUN=true`) — all mutating calls return previews until disabled
- Zod input validation on all tools
- Structured content responses (`structuredContent`) alongside text for MCP clients that support it

#### Tools — Status
- `xc_server_status` — show tenant, base URL, auth method, dry-run state

#### Tools — Identity & Access (UC-1)
- `xc_list_namespaces`, `xc_get_namespace`, `xc_create_namespace`, `xc_delete_namespace`
- `xc_list_user_groups`, `xc_get_user_group`, `xc_create_user_group`, `xc_update_user_group`, `xc_delete_user_group`
- `xc_list_api_credentials`

#### Tools — Load Balancer (UC-2)
- `xc_list_origin_pools`, `xc_get_origin_pool`, `xc_create_origin_pool`, `xc_update_origin_pool`, `xc_delete_origin_pool`
- `xc_list_http_lbs`, `xc_get_http_lb`, `xc_create_http_lb`, `xc_update_http_lb`, `xc_delete_http_lb`

#### Tools — Security (UC-3)
- `xc_list_app_firewalls`, `xc_get_app_firewall`, `xc_create_app_firewall`, `xc_update_app_firewall`, `xc_delete_app_firewall`
- `xc_list_service_policies`, `xc_get_service_policy`, `xc_create_service_policy`, `xc_update_service_policy`, `xc_delete_service_policy`

#### Tools — API Security (UC-4)
- `xc_list_api_definitions`, `xc_get_api_definition`, `xc_create_api_definition`, `xc_update_api_definition`, `xc_delete_api_definition`
- `xc_list_app_api_groups`, `xc_get_app_api_group`, `xc_create_app_api_group`, `xc_delete_app_api_group`
- `xc_raw_request` — escape hatch to call any F5 XC API endpoint directly

#### Services
- `F5XcClient` — Axios-based HTTP client with API token auth, error mapping, dry-run support
- `loadConfig()` — env-based configuration with sensible defaults
- `handleApiError()` — maps HTTP status codes to actionable error messages

#### Deployment
- Deployed to Azure Ubuntu VM (`australiaeast`) via systemd service `f5-xc-mcp.service`
- Node.js v20 via nvm
- `.env` file for runtime configuration

#### Known API Limitations
- F5 XC REST API does **not** route write operations for user/group management (`POST`/`PUT`/`DELETE` on `/api/web/namespaces/system/user_groups` return `404` or `501 Not Implemented`)
- User creation is also not available via REST API (returns `501`)
- These operations must be performed via the F5 XC Console or vesctl CLI
