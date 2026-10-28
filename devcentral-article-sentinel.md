# Streaming F5 XC WAF Events to Microsoft Sentinel

## How I wired F5 Distributed Cloud security logs into Azure Sentinel, and the five things that broke along the way

### The Problem

I had an F5 XC HTTP load balancer with a WAF policy in blocking mode. The WAF was catching attacks, but the security events lived inside the F5 XC console. My SOC team uses Microsoft Sentinel. They needed the WAF events in Sentinel so they could correlate them with other security signals, build hunting queries, and trigger automated incident response.

The goal: attack hits the WAF, WAF blocks it, event shows up in Sentinel within minutes. No manual export, no scheduled pulls.

### My Setup

- F5 XC tenant: `a-msp-c-partner`
- HTTP Load Balancer: `mcpdemo` in namespace `mcp-demo`, serving `mcpdemo.ai-demo.fun`
- WAF policy: `demo-waf-policy-1` in blocking mode
- Azure subscription with a resource group `rg-sentinel-f5xc` in Australia East

The pipeline I built:

```
F5 XC WAF → Global Log Receiver → Azure Event Hub → Azure Function → Log Analytics → Sentinel
```

### Step 1: Create the HTTP Load Balancer and WAF Policy in F5 XC

Before wiring up the log pipeline, you need something generating WAF events. Here is how I set up the load balancer and WAF policy.

**Create an Origin Pool:**

1. In the F5 XC Console, go to **Multi-Cloud App Connect** > **Manage** > **Load Balancers** > **Origin Pools**
2. Click **Add Origin Pool**
3. Name: `mcpdemo-origin`
4. Origin Servers: add your backend IP and port (mine was `10.10.10.10` on port `80`)
5. Health Check: select or create an HTTP health check
6. Save

**Create the HTTP Load Balancer:**

1. Go to **Load Balancers** > **HTTP Load Balancers**
2. Click **Add HTTP Load Balancer**
3. Name: `mcpdemo`
4. Domains: `mcpdemo.ai-demo.fun`
5. Load Balancer Type: **HTTPS with Automatic Certificate**
6. Under HTTPS, set the port to `443` and enable **HTTP Redirect** (port 80 redirects to 443)
7. Origin Pools: attach `mcpdemo-origin`
8. Save

**Create the WAF Policy:**

1. Go to **Manage** > **App Firewall**
2. Click **Add App Firewall**
3. Name: `demo-waf-policy-1`
4. Enforcement Mode: **Blocking**
5. Detection Settings: leave defaults (covers OWASP top attacks including SQL injection, XSS, command injection, remote file include)
6. Bot Defense: leave defaults or enable as needed
7. Save

**Attach the WAF Policy to the Load Balancer:**

1. Go back to **HTTP Load Balancers**, click the three dots next to `mcpdemo`, select **Manage Configuration**
2. Click **Edit Configuration**
3. Scroll to **Web Application Firewall**, select **Enable**
4. Choose `demo-waf-policy-1`
5. Save and Exit

At this point, any malicious request hitting `mcpdemo.ai-demo.fun` gets blocked by the WAF. The F5 XC Security Analytics dashboard shows the events:

![F5 XC Security Analytics showing 9 WAF events with risk scores, source IPs, methods, and block actions](screenshots/xc-security-events-list.png)

Clicking into an event shows the detection details, including the attack signatures matched and the AI-confirmed risk assessment:

![WAF event detail showing PHP remote file include detection with signature ID 200022012, high accuracy, and AI-confirmed detection](screenshots/xc-security-event-detail.png)

### Step 2: Create the Azure Resources

I needed four things in Azure: an Event Hub to receive the events, a Log Analytics workspace for Sentinel, a Function App to transform and forward the data, and Sentinel itself.

**Event Hub namespace and instance:**

```bash
az eventhubs namespace create \
  --resource-group rg-sentinel-f5xc \
  --name f5xc-security-events \
  --location australiaeast \
  --sku Standard

az eventhubs eventhub create \
  --resource-group rg-sentinel-f5xc \
  --namespace-name f5xc-security-events \
  --name f5xc-waf-logs \
  --message-retention 1 \
  --partition-count 4
```

**Two access policies, one for each direction:**

```bash
# F5 XC sends events in
az eventhubs namespace authorization-rule create \
  --resource-group rg-sentinel-f5xc \
  --namespace-name f5xc-security-events \
  --name f5xc-send-policy \
  --rights Send

# Azure Function reads events out
az eventhubs namespace authorization-rule create \
  --resource-group rg-sentinel-f5xc \
  --namespace-name f5xc-security-events \
  --name f5xc-listen-policy \
  --rights Listen
```

Save both connection strings. You will need the Send string for F5 XC and the Listen string for the Function App.

```bash
# Send connection string (for F5 XC Global Log Receiver)
az eventhubs namespace authorization-rule keys list \
  --resource-group rg-sentinel-f5xc \
  --namespace-name f5xc-security-events \
  --name f5xc-send-policy \
  --query primaryConnectionString -o tsv

# Listen connection string (for Azure Function)
az eventhubs namespace authorization-rule keys list \
  --resource-group rg-sentinel-f5xc \
  --namespace-name f5xc-security-events \
  --name f5xc-listen-policy \
  --query primaryConnectionString -o tsv
```

**Log Analytics workspace:**

```bash
az monitor log-analytics workspace create \
  --resource-group rg-sentinel-f5xc \
  --workspace-name f5xc-waf-workspace \
  --location australiaeast
```

**Enable Sentinel on the workspace:**

In the Azure Portal, search "Microsoft Sentinel", click **+ Create**, and select `f5xc-waf-workspace`.

![Microsoft Sentinel workspace selection showing f5xc-waf-workspace](screenshots/sentinel-workspace-selection.png)

After enabling, the Sentinel overview page confirms the workspace is active:

![Microsoft Sentinel overview page for f5xc-waf-workspace](screenshots/sentinel-overview.png)

### Step 3: Configure the F5 XC Global Log Receiver

This is the piece that tells F5 XC to stream security events out of the platform.

1. Log in to the F5 XC Console
2. Navigate to **Multi-Cloud Network Connect** > **Manage** > **Log Management** > **Global Log Receiver**
3. Click **Add Global Log Receiver**

![Global Log Receiver list showing azure-sentinel-waf with Status Up](screenshots/xc-global-log-receiver-list.png)

4. Configure the receiver:
   - **Name**: `azure-sentinel-waf`
   - **Description**: `Stream F5 XC security events to Azure Sentinel via Event Hub`
   - **Log Type**: Security Events
   - **Log Message Selection**: Select logs in specific namespaces, add `mcp-demo`
   - **Receiver Configuration**: Azure Event Hubs
   - **Connection String**: paste the **Send** connection string from Step 2
   - **Event Hubs Namespace**: `f5xc-security-events`
   - **Event Hubs Instance**: `f5xc-waf-logs`

5. Click **Save and Exit**

![Global Log Receiver configuration showing Security Events log type, mcp-demo namespace, Azure Event Hubs receiver with connection string configured](screenshots/xc-global-log-receiver-config.png)

One thing I learned the hard way: do not try to set the connection string through the F5 XC REST API. I tried using a PUT request with `clear_secret_info` and the base64-encoded connection string. The API accepted it (returned 200), but the secret never actually persisted. The GET response showed `blindfold_secret_info_internal: null`. The connection string has to be entered through the Console UI, which handles the blindfold encryption properly.

### Step 4: Build and Deploy the Azure Function

I initially tried using a Logic App with the "Azure Log Analytics Data Collector" connector. The Logic App triggered correctly on every Event Hub message and the connector returned HTTP 200 on every send. But no data ever appeared in Log Analytics. After hours of debugging, I confirmed the connector silently drops data. The direct HTTP API with the same workspace credentials and same data worked every time.

So I switched to an Azure Function. Here is the function code:

**`ingest_waf_events/__init__.py`**

```python
import json
import hashlib
import hmac
import base64
import datetime
import logging
import os
from typing import List
import requests
import azure.functions as func


def _flatten_event(raw):
    return {
        "TimeGenerated": raw.get("@timestamp",
            datetime.datetime.now(datetime.UTC).isoformat()),
        "action": raw.get("action", ""),
        "app_firewall_name": raw.get("app_firewall_name", ""),
        "attack_types": json.dumps(raw.get("attack_types", [])),
        "authority": raw.get("authority", ""),
        "country": raw.get("country", ""),
        "method": raw.get("method", ""),
        "req_path": raw.get("req_path", ""),
        "severity": raw.get("severity", ""),
        "src_ip": raw.get("src_ip", ""),
        "violations": json.dumps(raw.get("violations", [])),
        "waf_mode": raw.get("waf_mode", ""),
    }


def main(events: List[func.EventHubEvent]):
    workspace_id = os.environ["WORKSPACE_ID"]
    workspace_key = os.environ["WORKSPACE_KEY"]
    log_type = "F5XCWAFEvents"

    records = []
    for event in events:
        try:
            body = event.get_body().decode("utf-8")
            raw = json.loads(body) if body.startswith("{") else {"RawData": body}
            record = _flatten_event(raw)
            records.append(record)
        except Exception as e:
            logging.error(f"Failed to parse event: {e}")

    if not records:
        return

    post_data = json.dumps(records)
    rfc1123date = datetime.datetime.now(datetime.UTC).strftime(
        "%a, %d %b %Y %H:%M:%S GMT")

    signature = _build_signature(
        workspace_key, rfc1123date, len(post_data),
        "POST", "application/json", "/api/logs")

    uri = (f"https://{workspace_id}.ods.opinsights.azure.com"
           f"/api/logs?api-version=2016-04-01")
    headers = {
        "content-type": "application/json",
        "Authorization": signature,
        "Log-Type": log_type,
        "x-ms-date": rfc1123date,
    }

    response = requests.post(uri, data=post_data, headers=headers)
    if 200 <= response.status_code < 300:
        logging.info(f"Ingested {len(records)} events to Log Analytics")
    else:
        logging.error(
            f"Log Analytics rejected: {response.status_code} {response.text}")


def _build_signature(shared_key, date, content_length,
                     method, content_type, resource):
    x_headers = f"x-ms-date:{date}"
    string_to_hash = (f"{method}\n{content_length}\n{content_type}"
                      f"\n{x_headers}\n{resource}")
    decoded_key = base64.b64decode(shared_key)
    encoded_hash = base64.b64encode(
        hmac.HMAC(decoded_key, string_to_hash.encode("utf-8"),
                  digestmod=hashlib.sha256).digest()
    ).decode("utf-8")
    return f"SharedKey {os.environ['WORKSPACE_ID']}:{encoded_hash}"
```

**`ingest_waf_events/function.json`**

```json
{
  "scriptFile": "__init__.py",
  "bindings": [
    {
      "type": "eventHubTrigger",
      "name": "events",
      "direction": "in",
      "eventHubName": "f5xc-waf-logs",
      "connection": "EventHubConnection",
      "cardinality": "many",
      "consumerGroup": "$Default"
    }
  ]
}
```

**`host.json`**

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

**`requirements.txt`**

```
azure-functions
requests
```

#### Why `_flatten_event` only extracts 12 fields

F5 XC WAF events contain over 80 fields, including nested objects like `attack_types` (array of dicts), `kubernetes` (nested dict), and `signatures` (array of dicts). They also have reserved field names like `@timestamp`, `_id`, and `_visitor_id`.

I sent the raw 80-field events directly to the Data Collector API. It returned HTTP 200 every time. But the records never appeared in Log Analytics.

After isolating the problem with progressive field-count tests, I found that the Data Collector API silently drops records that introduce more than about 15 new columns in a single batch. It accepts the POST, returns 200, and throws the data away. No error message, no diagnostic, nothing in the Operation table.

The fix: extract only the fields that matter for SOC analysis and stringify any nested objects with `json.dumps()`. Twelve fields is well under the limit and covers the key information: who attacked, what they hit, what the WAF did about it.

#### Deploy the Function App

```bash
# Create storage account and Function App
az storage account create \
  --resource-group rg-sentinel-f5xc \
  --name f5xcwafsa \
  --location australiaeast \
  --sku Standard_LRS

az functionapp create \
  --resource-group rg-sentinel-f5xc \
  --name f5xc-waf-ingest \
  --storage-account f5xcwafsa \
  --consumption-plan-location australiaeast \
  --runtime python \
  --runtime-version 3.11 \
  --functions-version 4 \
  --os-type Linux
```

Set the environment variables:

```bash
WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group rg-sentinel-f5xc \
  --workspace-name f5xc-waf-workspace \
  --query customerId -o tsv)

WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --resource-group rg-sentinel-f5xc \
  --workspace-name f5xc-waf-workspace \
  --query primarySharedKey -o tsv)

LISTEN_CS=$(az eventhubs namespace authorization-rule keys list \
  --resource-group rg-sentinel-f5xc \
  --namespace-name f5xc-security-events \
  --name f5xc-listen-policy \
  --query primaryConnectionString -o tsv)

az functionapp config appsettings set \
  --resource-group rg-sentinel-f5xc \
  --name f5xc-waf-ingest \
  --settings \
    WORKSPACE_ID="$WORKSPACE_ID" \
    WORKSPACE_KEY="$WORKSPACE_KEY" \
    EventHubConnection="$LISTEN_CS"
```

Deploy the function:

```bash
cd azure-function
func azure functionapp publish f5xc-waf-ingest --python
```

The output should show:

```
Functions in f5xc-waf-ingest:
    ingest_waf_events - [eventHubTrigger]
```

If the function list is empty after deployment, check two things. First, `host.json` must have `"version": "2.0"`. Second, use `List[func.EventHubEvent]` (from `typing`), not `list[func.EventHubEvent]`. Python 3.11 on the Azure Functions v1 programming model does not support the lowercase `list` type hint for bindings. The function host will log `FunctionLoadError: binding events has invalid non-type annotation` and silently skip the function.

### Step 5: Test the Pipeline with Real Attacks

I sent three types of attacks against my WAF-protected endpoint to generate security events.

**SQL Injection:**

```bash
curl -s "https://mcpdemo.ai-demo.fun/index.php?id=1'+OR+1=1--"
```

**Cross-Site Scripting:**

```bash
curl -s "https://mcpdemo.ai-demo.fun/index.php?q=<script>alert(document.cookie)</script>"
```

**PHP Remote Code Execution (CVE-2026-109618 pattern):**

```bash
curl -s "https://mcpdemo.ai-demo.fun/index.php?-d+allow_url_include%3d1+-d+auto_prepend_file%3dphp://input" \
  -X POST -d '<?php system("id"); ?>'
```

All three returned the WAF block page: "The requested URL was rejected."

I ran each attack three times (9 total). After five minutes, I ran this query in Sentinel:

```kusto
F5XCWAFEvents_CL
| where action_s == "block"
| where TimeGenerated > ago(24h)
| project TimeGenerated, src_ip_s, method_s, req_path_s,
          attack_types_s, authority_s, country_s
| sort by TimeGenerated desc
```

All 9 events appeared, with the full attack classification from the WAF:

![Sentinel query showing 9 blocked WAF events with source IP 203.47.24.241, attack types including SQL injection, XSS, server-side code injection, remote file include, and command execution](screenshots/sentinel-blocked-events.png)

The expanded event detail shows each attack type detected. The PHP RCE payload triggered three signatures: `ATTACK_TYPE_SERVER_SIDE_CODE_INJECTION`, `ATTACK_TYPE_REMOTE_FILE_INCLUDE`, and `ATTACK_TYPE_COMMAND_EXECUTION`.

### Step 6: KQL Queries for Threat Hunting

Once the data flows, here are the queries I use daily.

**Top attacking source IPs:**

```kusto
F5XCWAFEvents_CL
| where TimeGenerated > ago(7d)
| where action_s == "block"
| summarize AttackCount = count() by src_ip_s, country_s
| sort by AttackCount desc
| take 10
```

![Sentinel query showing top attacking IP 203.47.24.241 from AU with 9 attacks](screenshots/sentinel-top-ips.png)

**Attack breakdown by type (pie chart):**

```kusto
F5XCWAFEvents_CL
| where TimeGenerated > ago(7d)
| extend attacks = parse_json(attack_types_s)
| mv-expand attack = attacks
| summarize count() by tostring(attack.name)
| sort by count_ desc
| render piechart
```

This query parses the JSON array in `attack_types_s`, expands each attack type into its own row, then counts. The pie chart shows the distribution across SQL injection, XSS, server-side code injection, remote file include, and command execution:

![Sentinel pie chart showing even 20% distribution across five attack types: SQL injection, server-side code injection, remote file include, command execution, and cross-site scripting](screenshots/sentinel-attack-piechart.png)

### What Went Wrong (and How I Fixed It)

This project had five distinct failures before the pipeline worked end to end. Each one returned HTTP 200 somewhere in the chain, which made it look like everything was fine.

**1. Wrong workspace.** I had two Log Analytics workspaces in the same resource group: `f5xc-waf-workspace` and `f5xc-sentinel-workspace`. I was querying in the wrong one. The fix was checking which workspace ID the data connector targeted and switching my queries.

**2. Global Log Receiver connection string not persisting.** The F5 XC REST API accepted the PUT with the connection string but never stored it. The Event Hub showed zero incoming messages for hours. I re-entered the connection string through the F5 XC Console UI, and events started flowing within a minute.

**3. Logic App connector silently dropping data.** The Azure Log Analytics Data Collector connector in Logic Apps returned HTTP 200 on every call. No records appeared. The same data sent through a direct HTTP POST with HMAC signing worked. I replaced the Logic App with an Azure Function.

**4. Function App type annotation error.** The function deployed but never appeared in `az functionapp function list`. App Insights showed `FunctionLoadError: binding events has invalid non-type annotation list[azure.functions._eventhub.EventHubEvent]`. Changing `list[func.EventHubEvent]` to `List[func.EventHubEvent]` (imported from `typing`) fixed it.

**5. Data Collector API silently dropping records with too many columns.** F5 XC WAF events have 80+ fields. The API accepted the POST (HTTP 200) but never created the records. Progressive field-count testing showed that batches introducing more than about 15 new columns get silently dropped. Flattening to 12 essential string fields fixed it.

### Lessons Learned

1. **The Data Collector API returns 200 for data it will never ingest.** There is no way to distinguish a successful ingestion from a silent drop based on the HTTP response alone. If your custom log table stays empty, reduce the field count.

2. **Always check Event Hub metrics first.** Azure Portal > Event Hub > Metrics > Incoming Messages tells you immediately whether F5 XC is sending events. If the count is zero, the problem is the Global Log Receiver, not Azure.

3. **Use separate access policies for Send and Listen.** F5 XC needs Send. The Azure Function needs Listen. Using the root key works but violates least privilege.

4. **App Insights on the Function App is not optional.** Without it, the `FunctionLoadError` was invisible. I would have kept redeploying the same broken code.

5. **Custom log table schema extension takes time.** The first batch of records to a new table can take 10 to 15 minutes to appear in Sentinel. Subsequent batches arrive in 3 to 5 minutes.

### Try It Yourself

The complete Function App code and setup guide are on GitHub:

**[github.com/gavinw2006/f5xc-to-azure-sentinel](https://github.com/gavinw2006/f5xc-to-azure-sentinel)**

Prerequisites: an F5 XC tenant with a WAF-protected HTTP load balancer, an Azure subscription, Azure CLI, and Azure Functions Core Tools (`func`).

---

*Drafted with help from AI, then tested and edited by the author.*
