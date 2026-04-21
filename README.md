# F5 XC MCP Server

An MCP (Model Context Protocol) server that acts as an F5 Distributed Cloud expert — translating natural language commands from Claude Code or GitHub Copilot into F5 XC API calls.

## Use Cases (v1.0)

| UC | Capability |
|---|---|
| UC-1 | User / Group / Namespace administration |
| UC-2 | HTTP Load Balancer and Origin Pool CRUD |
| UC-3 | WAF (App Firewalls), Service Policies, Bot Defense, DDoS rules |
| UC-4 | API Discovery, API Security (API Definitions, App API Groups) |

F5 XC API reference: https://docs.cloud.f5.com/docs-v2/api

---

## Quick Start

### 1. Install dependencies

```bash
npm install
npm run build
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — set F5_XC_TENANT and F5_XC_API_TOKEN at minimum
```

Generate an API token: F5 XC Console → **Account** → **Credentials** → **Add Credentials** → API Token.

### 3. Run

```bash
# Local stdio mode (for Claude Code / Copilot)
npm start

# Development with auto-reload
npm run dev

# HTTP mode (for remote/multi-client deployment)
TRANSPORT=http npm start
```

---

## Safety: Dry-Run Mode

**Dry-run is ON by default** (`F5_XC_DRY_RUN=true`). Every mutating call (POST/PUT/DELETE) returns a preview of what would be sent, without touching F5 XC. Use `xc_server_status` to verify the current state.

To enable live calls:
```bash
F5_XC_DRY_RUN=false npm start
```

Or pass `dryRun: false` per tool call to override for a single operation.

---

## Claude Code Integration (stdio)

Add to your Claude Code MCP config (`~/.claude.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "f5-xc": {
      "command": "node",
      "args": ["/path/to/F5_XC_MCP_Server/dist/index.js"],
      "env": {
        "F5_XC_TENANT": "your-tenant",
        "F5_XC_API_TOKEN": "your-api-token",
        "F5_XC_DEFAULT_NAMESPACE": "your-namespace",
        "F5_XC_DRY_RUN": "false"
      }
    }
  }
}
```

---

## Remote Deployment (HTTP mode)

Deployable on Ubuntu VM (AWS/Azure/GCP/Raspberry Pi):

```bash
# Install Node 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Clone and build
git clone <repo-url> F5_XC_MCP_Server
cd F5_XC_MCP_Server
npm install && npm run build

# Configure
cp .env.example .env  # fill in credentials

# Run as HTTP server
TRANSPORT=http PORT=3000 npm start
```

Health check endpoint: `GET /health`  
MCP endpoint: `POST /mcp`

---

## Available Tools

### Status
| Tool | Description |
|---|---|
| `xc_server_status` | Show configuration and dry-run state |

### Identity & Access (UC-1)
| Tool | Description |
|---|---|
| `xc_list_namespaces` | List all tenant namespaces |
| `xc_get_namespace` | Get namespace details |
| `xc_create_namespace` | Create a namespace |
| `xc_delete_namespace` | Delete a namespace |
| `xc_list_user_groups` | List user groups |
| `xc_get_user_group` | Get user group details |
| `xc_create_user_group` | Create user group with role bindings |
| `xc_update_user_group` | Update user group |
| `xc_delete_user_group` | Delete user group |
| `xc_list_api_credentials` | List API credentials (audit) |

### Load Balancer (UC-2)
| Tool | Description |
|---|---|
| `xc_list_origin_pools` | List origin pools |
| `xc_get_origin_pool` | Get origin pool spec |
| `xc_create_origin_pool` | Create origin pool |
| `xc_update_origin_pool` | Update origin pool |
| `xc_delete_origin_pool` | Delete origin pool |
| `xc_list_http_lbs` | List HTTP load balancers |
| `xc_get_http_lb` | Get HTTP LB spec |
| `xc_create_http_lb` | Create HTTP LB |
| `xc_update_http_lb` | Update HTTP LB |
| `xc_delete_http_lb` | Delete HTTP LB |

### Security (UC-3)
| Tool | Description |
|---|---|
| `xc_list_app_firewalls` | List WAF policies |
| `xc_get_app_firewall` | Get WAF policy spec |
| `xc_create_app_firewall` | Create WAF policy |
| `xc_update_app_firewall` | Update WAF policy |
| `xc_delete_app_firewall` | Delete WAF policy |
| `xc_list_service_policies` | List service/API protection/DDoS policies |
| `xc_get_service_policy` | Get service policy spec |
| `xc_create_service_policy` | Create service policy |
| `xc_update_service_policy` | Update service policy |
| `xc_delete_service_policy` | Delete service policy |

### API Security (UC-4)
| Tool | Description |
|---|---|
| `xc_list_api_definitions` | List API definitions |
| `xc_get_api_definition` | Get API definition spec |
| `xc_create_api_definition` | Create API definition |
| `xc_update_api_definition` | Update API definition |
| `xc_delete_api_definition` | Delete API definition |
| `xc_list_app_api_groups` | List API endpoint groups |
| `xc_get_app_api_group` | Get API endpoint group |
| `xc_create_app_api_group` | Create API endpoint group |
| `xc_raw_request` | Raw API request (escape hatch) |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `F5_XC_TENANT` | — | Tenant name; builds `https://{tenant}.console.ves.volterra.io` |
| `F5_XC_BASE_URL` | — | Override base URL (takes precedence over tenant) |
| `F5_XC_API_TOKEN` | — | API token from F5 XC Console |
| `F5_XC_DEFAULT_NAMESPACE` | `system` | Default namespace for tools |
| `F5_XC_DRY_RUN` | `true` | `false` to enable live API calls |
| `TRANSPORT` | `stdio` | `http` for remote HTTP mode |
| `PORT` | `3000` | HTTP port when `TRANSPORT=http` |

---

## Development

```bash
npm run dev     # run with tsx auto-reload
npm run check   # type-check only
npm run build   # compile to dist/
npm run clean   # remove dist/
```
