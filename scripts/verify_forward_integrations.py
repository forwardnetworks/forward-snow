#!/usr/bin/env python3
"""Verify Forward-side ServiceNow ticketing and CMDB configuration."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from configure_forward_integrations import (
    DEFAULT_FORWARD_BASE_URL,
    ForwardClient,
    ForwardError,
    env,
    parse_forward_token_file,
    truthy,
)


def forward_credentials() -> tuple[str, str]:
    username = env("FORWARD_USERNAME")
    password = env("FORWARD_PASSWORD")
    if username and password:
        return username, password
    token_file = env("FORWARD_TOKEN_FILE")
    if token_file:
        return parse_forward_token_file(Path(token_file).expanduser())
    raise SystemExit("set FORWARD_USERNAME/FORWARD_PASSWORD or FORWARD_TOKEN_FILE")


def summarize_status(status: Any) -> str:
    if not isinstance(status, dict):
        return "unknown"
    if status.get("error") or status.get("errorMessage"):
        return "error"
    if status.get("status"):
        return str(status["status"])
    if status.get("connectionStatus"):
        return str(status["connectionStatus"])
    return "ok"


def latest_history_item(history: Any) -> Any:
    if isinstance(history, dict):
        for key in ("items", "history", "synchronizations", "syncHistory"):
            rows = history.get(key)
            if isinstance(rows, list) and rows:
                return rows[0]
    if isinstance(history, list) and history:
        return history[0]
    return None


def main() -> int:
    username, password = forward_credentials()
    client = ForwardClient(env("FORWARD_BASE_URL", DEFAULT_FORWARD_BASE_URL), username, password)

    ticketing_status, ticketing, _ = client.request("GET", "/integrations/servicenow")
    cmdb_config_status, cmdb_config, _ = client.request("GET", "/integrations/servicenow-cmdb/configuration")

    if truthy(env("PUSH_CMDB")):
        client.request("POST", "/integrations/servicenow-cmdb?action=push")

    _, cmdb_status, _ = client.request("GET", "/integrations/servicenow-cmdb/status")
    _, sync_history, _ = client.request("GET", "/integrations/servicenow-cmdb/synchronization-history")

    summary = {
        "ticketingConfigured": 200 <= ticketing_status < 300 and isinstance(ticketing, dict),
        "ticketingEnabled": bool(isinstance(ticketing, dict) and ticketing.get("enabled")),
        "cmdbConfigured": 200 <= cmdb_config_status < 300 and isinstance(cmdb_config, dict),
        "cmdbEnabled": bool(isinstance(cmdb_config, dict) and cmdb_config.get("enabled")),
        "cmdbStatus": summarize_status(cmdb_status),
        "latestSync": latest_history_item(sync_history),
        "pushRequested": truthy(env("PUSH_CMDB")),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))

    if not summary["ticketingConfigured"] or not summary["cmdbConfigured"]:
        raise ForwardError("ServiceNow ticketing or CMDB configuration is missing")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ForwardError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
