# F5 XC MCP Server

An MCP (Model Context Protocol) server that acts as an F5 Distributed Cloud expert — translating natural language commands from Claude Code or GitHub Copilot into F5 XC API calls. When REST API operations are unavailable (e.g. user group management), tools automatically fall back to generating and applying Terraform HCL via the `volterraedge/volterra` provider.

F5 XC API reference: https://docs.cloud.f5.com/docs-v2/api

## Use Cases (v1.0)

| UC | Capability |
|---|---|
| UC-1 | User / Group / Namespace administration |
| UC-2 | HTTP Load Balancer and Origin Pool CRUD |
| UC-3 | WAF (App Firewalls), Service Policies, Bot Defense, DDoS rules |
| UC-4 | API Discovery, API Security (API Definitions, App API Groups) |
| TF | Terraform fallback — generate & apply HCL for any F5 XC resource |

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

## Remote Deployment (HTTPS mode)

The server runs on port 3000 (HTTP, internal) behind **Caddy** which handles TLS termination and automatic Let's Encrypt certificates.

### 1. Install and build

```bash
# Install Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20 && nvm use 20

git clone https://github.com/gavinw2006/F5_XC_MCP_Server
cd F5_XC_MCP_Server
npm install && npm run build
cp .env.example .env  # fill in F5_XC_TENANT, F5_XC_API_TOKEN, F5_XC_DRY_RUN=false
```

### 2. Run the MCP server as a systemd service

```bash
sudo cp deployment/f5-xc-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now f5-xc-mcp
```

### 3. Install Caddy and configure HTTPS

```bash
# Install Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Deploy Caddyfile (edit domain first)
sudo cp deployment/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy automatically obtains and renews a Let's Encrypt certificate for your domain. Ensure:
- DNS A record points to the VM's public IP
- Ports **80** (ACME challenge) and **443** (HTTPS) are open in your firewall/NSG

The `deployment/Caddyfile` template uses `mcp.xcdemo.site` — replace with your domain.

After setup:
- MCP endpoint: `POST https://your-domain/mcp`
- Health check: `GET https://your-domain/health`

---

## Available Tools

### Status
| Tool | Description |
|---|---|
| `xc_server_status` | Show configuration, auth method, dry-run state, and Terraform status |

### Identity & Access (UC-1)
| Tool | Description |
|---|---|
| `xc_list_namespaces` | List all tenant namespaces |
| `xc_get_namespace` | Get namespace details |
| `xc_create_namespace` | Create a namespace |
| `xc_delete_namespace` | Delete a namespace |
| `xc_list_user_groups` | List user groups |
| `xc_get_user_group` | Get user group details |
| `xc_create_user_group` | Create user group — REST first, Terraform HCL fallback on failure |
| `xc_update_user_group` | Update user group — REST first, Terraform HCL fallback on failure |
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
| `xc_raw_request` | Raw API request (escape hatch for any F5 XC endpoint) |

### Terraform Fallback
| Tool | Description |
|---|---|
| `xc_tf_generate_hcl` | Generate Terraform HCL for any F5 XC resource (read-only, no execution) |
| `xc_tf_plan` | Run `terraform plan` — safe preview of what would change |
| `xc_tf_apply` | Run `terraform apply` to create or update a resource |
| `xc_tf_destroy` | Run `terraform destroy` to delete a resource |

**Supported Terraform resource types:**  
`namespace`, `user_group`, `http_loadbalancer`, `origin_pool`, `app_firewall`, `service_policy`, `api_definition`, `app_api_group`, `virtual_network`, `virtual_host`, `healthcheck`

---

## Authentication

### REST API (choose one)
- **API token**: set `F5_XC_API_TOKEN`
- **mTLS**: set `F5_XC_CERT_PATH` + `F5_XC_KEY_PATH` (PEM files)

### Terraform Fallback (optional)
The `volterraedge/volterra` Terraform provider requires certificate auth. Add to `.env`:

```bash
# Option A: reuse PEM files already configured for mTLS
F5_XC_CERT_PATH=/path/to/cert.pem
F5_XC_KEY_PATH=/path/to/key.pem

# Option B: point to the .p12 credential file from F5 XC Console
F5_XC_P12_PATH=/path/to/creds.p12
F5_XC_P12_PASSWORD=your-p12-password
```

To extract PEM files from a `.p12`:
```bash
openssl pkcs12 -legacy -in creds.p12 -nokeys -clcerts -out cert.pem
openssl pkcs12 -legacy -in creds.p12 -nocerts -nodes -out key.pem
```

Also ensure `terraform` is installed on the server (`F5_XC_TF_BIN` to override path).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `F5_XC_TENANT` | — | Tenant name; builds `https://{tenant}.console.ves.volterra.io` |
| `F5_XC_BASE_URL` | — | Override base URL (takes precedence over tenant) |
| `F5_XC_API_TOKEN` | — | API token from F5 XC Console |
| `F5_XC_CERT_PATH` | — | PEM certificate path (mTLS + Terraform auth) |
| `F5_XC_KEY_PATH` | — | PEM private key path (mTLS + Terraform auth) |
| `F5_XC_DEFAULT_NAMESPACE` | `system` | Default namespace for tools |
| `F5_XC_DRY_RUN` | `true` | `false` to enable live API calls |
| `TRANSPORT` | `stdio` | `http` for remote HTTP mode |
| `PORT` | `3000` | HTTP port when `TRANSPORT=http` |
| `F5_XC_TF_BIN` | `terraform` | Path to terraform binary |
| `F5_XC_P12_PATH` | — | `.p12` credential file for Terraform auth |
| `F5_XC_P12_PASSWORD` | — | Password for the `.p12` file |

---

## F5 XC REST API Limitations

The F5 XC REST API does **not** expose write operations for user/group management — `POST`/`PUT`/`DELETE` on `/api/web/namespaces/system/user_groups` return 404. When these calls fail, `xc_create_user_group` and `xc_update_user_group` automatically include ready-to-run Terraform HCL in the response.

Workarounds:
- **Terraform**: `xc_tf_apply(resource_type="user_group", ...)` — requires cert auth
- **F5 XC Console**: Account → User Management → Groups

Namespace creation, load balancers, WAF policies, and all UC-2–UC-4 resources work fully via REST.

---

## Development

```bash
npm run dev     # run with tsx auto-reload
npm run check   # type-check only
npm run build   # compile to dist/
```
