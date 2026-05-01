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
| UC-4 | API Discovery, API Security, Web Application Scanning, API Security policies — create, configure, edit, delete |
| UC-5 | DNS Management — create DNS zones (system namespace only), add/edit/delete A and CNAME records via `default_rr_set_group`, delegate to F5 XC nameservers (`ns1/ns2.f5clouddns.com`) |

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
