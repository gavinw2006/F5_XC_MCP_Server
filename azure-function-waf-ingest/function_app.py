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

app = func.FunctionApp()


def _flatten_event(raw):
    return {
        "TimeGenerated": raw.get("@timestamp", datetime.datetime.now(datetime.UTC).isoformat()),
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


@app.event_hub_message_trigger(
    arg_name="events",
    event_hub_name="f5xc-waf-logs",
    connection="EventHubConnection",
    cardinality="many",
    consumer_group="$Default",
)
def ingest_waf_events(events: List[func.EventHubEvent]):
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
    content_length = len(post_data)
    rfc1123date = datetime.datetime.now(datetime.UTC).strftime("%a, %d %b %Y %H:%M:%S GMT")

    signature = _build_signature(
        workspace_key, rfc1123date, content_length, "POST", "application/json", "/api/logs"
    )

    uri = f"https://{workspace_id}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01"
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
        logging.error(f"Log Analytics rejected: {response.status_code} {response.text}")


def _build_signature(shared_key, date, content_length, method, content_type, resource):
    x_headers = f"x-ms-date:{date}"
    string_to_hash = f"{method}\n{content_length}\n{content_type}\n{x_headers}\n{resource}"
    bytes_to_hash = bytes(string_to_hash, encoding="utf-8")
    decoded_key = base64.b64decode(shared_key)
    encoded_hash = base64.b64encode(
        hmac.HMAC(decoded_key, bytes_to_hash, digestmod=hashlib.sha256).digest()
    ).decode("utf-8")
    return f"SharedKey {os.environ['WORKSPACE_ID']}:{encoded_hash}"
