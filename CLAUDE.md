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

## Git & Push Rules

- **Every push to the remote repo requires explicit user permission first.** Never push without asking.
- Remote repo: `F5_XC_MCP_Server` (to be created on GitHub)
- README and other repo files must be written before the first push.
