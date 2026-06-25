#!/usr/bin/env python3
"""Install or update the Forward ServiceNow workflow demo in one PDI.

The installer is intentionally idempotent. It uses ServiceNow's Table API to
create missing schema records and patch existing demo records in place.
"""

from __future__ import annotations

import base64
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


TICKET_TABLE = "u_forward_connectivity_ticket"
HOP_TABLE = "u_forward_connectivity_hop"
BINDING_TABLE = "u_forward_tenant_binding"
CHANGE_VALIDATION_TABLE = "u_forward_change_validation"
WIDGET_NAME = "Forward Workflow Demo"
WIDGET_ID = "forward-workflow-demo"
PAGE_ID = "connectivity_ticket"
EVENT_NAME = "x_fwd_demo.analyze_ticket"
DEFAULT_FORWARD_BASE_URL = "https://fwd.app/api"
DEFAULT_NETWORK_ID = "235937"
AUTH_PROFILE_TABLE = "sys_auth_profile_basic"
CHANGE_REQUEST_TABLE = "change_request"
PRODUCTION_MODE_ENV = "SN_PRODUCTION_MODE"


class ServiceNowError(RuntimeError):
    pass


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def require_env(name: str) -> str:
    value = env(name)
    if not value:
        raise SystemExit(f"missing required environment variable: {name}")
    return value


def parse_forward_token_file(path: Path) -> tuple[str, str]:
    text = path.read_text()
    access = re.search(r"Access key\s+([A-Za-z0-9-]+)", text, re.S)
    secret = re.search(r"Secret key\s+([A-Za-z0-9-]+)", text, re.S)
    if not access or not secret:
        raise SystemExit(f"could not parse Access key / Secret key from {path}")
    return access.group(1), secret.group(1)


class ServiceNowClient:
    def __init__(self, instance_url: str, username: str, password: str, dry_run: bool = False) -> None:
        self.instance_url = instance_url.rstrip("/")
        self.base_url = self.instance_url + "/api/now/table"
        self.dry_run = dry_run
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        self.auth_header = f"Basic {token}"
        self.ssl_context = ssl.create_default_context()

    def request(
        self,
        method: str,
        endpoint: str,
        payload: Any | None = None,
        *,
        ok_statuses: tuple[int, ...] = (),
    ) -> tuple[int, Any, str]:
        url = self.base_url + endpoint
        if self.dry_run and method != "GET":
            print(f"DRY-RUN {method} {url}")
            if payload is not None:
                print(json.dumps(redact(payload), indent=2, sort_keys=True))
            return 200, {"result": {"sys_id": "dry_run"}}, ""

        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self.auth_header)
        req.add_header("Accept", "application/json")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60, context=self.ssl_context) as resp:
                body = resp.read().decode(errors="replace")
                parsed = json.loads(body) if body.strip() else None
                return resp.status, parsed, body
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            if exc.code in ok_statuses:
                parsed = json.loads(body) if body.strip() else None
                return exc.code, parsed, body
            raise ServiceNowError(f"{method} {endpoint} failed: HTTP {exc.code}: {body.strip()}") from exc

    def query(
        self,
        table: str,
        encoded_query: str,
        *,
        fields: str = "sys_id",
        limit: int = 1,
    ) -> list[dict[str, Any]]:
        params = {
            "sysparm_query": encoded_query,
            "sysparm_fields": fields,
            "sysparm_limit": str(limit),
            "sysparm_display_value": "false",
        }
        endpoint = "/" + table + "?" + urllib.parse.urlencode(params)
        _, parsed, _ = self.request("GET", endpoint)
        rows = (parsed or {}).get("result", []) if isinstance(parsed, dict) else []
        return rows if isinstance(rows, list) else []

    def upsert(self, table: str, encoded_query: str, payload: dict[str, Any], label: str) -> str:
        fields = ["sys_id"]
        fields.extend(payload.keys())
        rows = self.query(table, encoded_query, fields=",".join(fields))
        if rows:
            sys_id = str(rows[0]["sys_id"])
            if record_matches(rows[0], payload):
                print(f"current {label}")
            else:
                self.request("PATCH", f"/{table}/{sys_id}", payload)
                print(f"updated {label}")
            return sys_id
        _, parsed, _ = self.request("POST", f"/{table}", payload)
        result = (parsed or {}).get("result", {}) if isinstance(parsed, dict) else {}
        sys_id = str(result.get("sys_id") or "")
        if not sys_id:
            raise ServiceNowError(f"created {label} but ServiceNow did not return sys_id")
        print(f"created {label}")
        return sys_id


def scalar(value: Any) -> str:
    if isinstance(value, dict) and "value" in value:
        return scalar(value.get("value"))
    if value is None:
        return ""
    return str(value)


def record_matches(row: dict[str, Any], payload: dict[str, Any]) -> bool:
    for key, desired in payload.items():
        if scalar(row.get(key)) != scalar(desired):
            return False
    return True


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if "password" in key.lower() or "secret" in key.lower():
                out[key] = "<redacted>"
            elif "username" in key.lower() and isinstance(item, str):
                out[key] = item[:3] + "..." if len(item) > 3 else "<redacted>"
            else:
                out[key] = redact(item)
        return out
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def asset(name: str) -> str:
    root = Path(__file__).resolve().parents[1]
    return (root / "servicenow" / "assets" / name).read_text()


def sys_id_for_table(client: ServiceNowClient, table_name: str) -> str:
    rows = client.query("sys_db_object", f"name={table_name}", fields="sys_id,name")
    if not rows:
        raise ServiceNowError(f"ServiceNow table not found: {table_name}")
    return str(rows[0]["sys_id"])


def table_exists(client: ServiceNowClient, table_name: str) -> bool:
    return bool(client.query("sys_db_object", f"name={table_name}", fields="sys_id,name"))


def query_ids(client: ServiceNowClient, table: str, encoded_query: str, *, limit: int = 200) -> list[str]:
    rows = client.query(table, encoded_query, fields="sys_id", limit=limit)
    return [str(row.get("sys_id") or "") for row in rows if row.get("sys_id")]


def delete_record(client: ServiceNowClient, table: str, sys_id: str, label: str) -> None:
    if not sys_id:
        return
    client.request("DELETE", f"/{table}/{sys_id}", ok_statuses=(404,))
    print(f"deleted duplicate {label}")


def unique_ids(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def ensure_tables(client: ServiceNowClient) -> None:
    task_id = sys_id_for_table(client, "task")
    definitions = [
        (TICKET_TABLE, "Forward Workflow Ticket", task_id),
        (HOP_TABLE, "Forward Workflow Hop", ""),
        (BINDING_TABLE, "Forward Tenant Binding", ""),
        (CHANGE_VALIDATION_TABLE, "Forward Change Validation", task_id),
    ]
    for name, label, super_class in definitions:
        payload = {
            "name": name,
            "label": label,
            "access": "public",
            "read_access": "true",
            "ws_access": "true",
        }
        if super_class:
            payload["super_class"] = super_class
        client.upsert("sys_db_object", f"name={name}", payload, f"table {name}")


def field(
    table: str,
    element: str,
    label: str,
    kind: str,
    *,
    reference: str = "",
    max_length: int = 40,
    default: str = "",
    choice: str = "",
) -> dict[str, Any]:
    payload = {
        "name": table,
        "element": element,
        "column_label": label,
        "internal_type": kind,
        "max_length": str(max_length),
        "active": "true",
    }
    if reference:
        payload["reference"] = reference
    if default:
        payload["default_value"] = default
    if choice:
        payload["choice"] = choice
    return payload


def upsert_dictionary_field(client: ServiceNowClient, item: dict[str, Any]) -> None:
    label = f"field {item['name']}.{item['element']}"
    fields = ["sys_id"]
    fields.extend(item.keys())
    rows = client.query("sys_dictionary", f"name={item['name']}^element={item['element']}", fields=",".join(fields))
    if not rows:
        client.upsert("sys_dictionary", f"name={item['name']}^element={item['element']}", item, label)
        return

    payload = dict(item)
    existing_type = scalar(rows[0].get("internal_type"))
    desired_type = scalar(item.get("internal_type"))
    if existing_type and desired_type and existing_type != desired_type:
        payload.pop("internal_type", None)
        print(
            f"warning {label} is {existing_type}; keeping existing type. "
            f"Recreate the field to use {desired_type}."
        )
    client.upsert("sys_dictionary", f"name={item['name']}^element={item['element']}", payload, label)


def ensure_fields(client: ServiceNowClient) -> None:
    auth_profile_supported = table_exists(client, AUTH_PROFILE_TABLE)
    change_request_supported = table_exists(client, CHANGE_REQUEST_TABLE)
    fields = [
        field(TICKET_TABLE, "u_source_ci", "Source CI", "reference", reference="cmdb_ci_netgear", max_length=32),
        field(TICKET_TABLE, "u_destination_ci", "Destination CI", "reference", reference="cmdb_ci_netgear", max_length=32),
        field(TICKET_TABLE, "u_src_ip", "Source IP", "string", max_length=45),
        field(TICKET_TABLE, "u_dst_ip", "Destination IP", "string", max_length=45),
        field(TICKET_TABLE, "u_protocol", "Protocol", "choice", default="TCP", choice="1"),
        field(TICKET_TABLE, "u_dst_port", "Destination Port", "integer"),
        field(TICKET_TABLE, "u_forward_network_id", "Forward Network ID", "string"),
        field(TICKET_TABLE, "u_forward_snapshot_id", "Forward Snapshot ID", "string"),
        field(TICKET_TABLE, "u_forward_tenant_username", "Forward Tenant Username", "string"),
        field(TICKET_TABLE, "u_allowed", "Allowed", "boolean", default="false"),
        field(TICKET_TABLE, "u_block_category", "Block Category", "choice", choice="1"),
        field(TICKET_TABLE, "u_block_device", "Block Device", "string"),
        field(TICKET_TABLE, "u_block_interface", "Block Interface", "string"),
        field(TICKET_TABLE, "u_block_rule", "Block Rule", "string"),
        field(TICKET_TABLE, "u_block_reason", "Block Reason", "string", max_length=4000),
        field(TICKET_TABLE, "u_forward_query_url", "Forward Query URL", "url", max_length=1024),
        field(TICKET_TABLE, "u_recommended_team", "Recommended Team", "choice", default="triage", choice="1"),
        field(TICKET_TABLE, "u_forward_evidence_summary", "Forward Evidence Summary", "html", max_length=4000),
        field(TICKET_TABLE, "u_incident", "Incident", "reference", reference="incident", max_length=32),
        field(TICKET_TABLE, "u_incident_number", "Incident Number", "string"),
        field(TICKET_TABLE, "u_raw_excerpt", "Raw Excerpt", "html", max_length=8000),
        field(TICKET_TABLE, "u_analysis_status", "Analysis Status", "choice", default="not_run", choice="1"),
        field(TICKET_TABLE, "u_analysis_error", "Analysis Error", "string", max_length=4000),
        field(HOP_TABLE, "u_ticket", "Ticket", "reference", reference=TICKET_TABLE, max_length=32),
        field(HOP_TABLE, "u_hop_index", "Hop Index", "integer"),
        field(HOP_TABLE, "u_device", "Device", "string"),
        field(HOP_TABLE, "u_ingress", "Ingress", "string"),
        field(HOP_TABLE, "u_egress", "Egress", "string"),
        field(HOP_TABLE, "u_note", "Note", "string", max_length=512),
        field(BINDING_TABLE, "u_tenant_username", "Tenant Username", "string"),
        field(BINDING_TABLE, "u_forward_base_url", "Forward Base URL", "url", max_length=1024),
        field(BINDING_TABLE, "u_forward_username", "Forward Username", "string", max_length=255),
        field(BINDING_TABLE, "u_forward_password", "Forward Password", "password2", max_length=1024),
        field(CHANGE_VALIDATION_TABLE, "u_src_ip", "Source IP", "string", max_length=45),
        field(CHANGE_VALIDATION_TABLE, "u_dst_ip", "Destination IP", "string", max_length=45),
        field(CHANGE_VALIDATION_TABLE, "u_protocol", "Protocol", "choice", default="TCP", choice="1"),
        field(CHANGE_VALIDATION_TABLE, "u_dst_port", "Destination Port", "integer"),
        field(CHANGE_VALIDATION_TABLE, "u_forward_network_id", "Forward Network ID", "string"),
        field(CHANGE_VALIDATION_TABLE, "u_forward_snapshot_id", "Forward Snapshot ID", "string"),
        field(CHANGE_VALIDATION_TABLE, "u_forward_tenant_username", "Forward Tenant Username", "string"),
        field(CHANGE_VALIDATION_TABLE, "u_expected_outcome", "Expected Outcome", "choice", choice="1"),
        field(CHANGE_VALIDATION_TABLE, "u_validation_status", "Validation Status", "choice", default="not_run", choice="1"),
        field(CHANGE_VALIDATION_TABLE, "u_allowed", "Allowed", "boolean", default="false"),
        field(CHANGE_VALIDATION_TABLE, "u_block_category", "Block Category", "choice", choice="1"),
        field(CHANGE_VALIDATION_TABLE, "u_block_device", "Block Device", "string"),
        field(CHANGE_VALIDATION_TABLE, "u_block_interface", "Block Interface", "string"),
        field(CHANGE_VALIDATION_TABLE, "u_block_rule", "Block Rule", "string"),
        field(CHANGE_VALIDATION_TABLE, "u_block_reason", "Block Reason", "string", max_length=4000),
        field(CHANGE_VALIDATION_TABLE, "u_forward_query_url", "Forward Query URL", "url", max_length=1024),
        field(CHANGE_VALIDATION_TABLE, "u_forward_evidence_summary", "Forward Evidence Summary", "html", max_length=4000),
        field(CHANGE_VALIDATION_TABLE, "u_raw_excerpt", "Raw Excerpt", "html", max_length=8000),
    ]
    if auth_profile_supported:
        fields.append(
            field(
                BINDING_TABLE,
                "u_forward_auth_profile",
                "Forward Auth Profile",
                "reference",
                reference=AUTH_PROFILE_TABLE,
                max_length=32,
            )
        )
    else:
        print(f"warning {AUTH_PROFILE_TABLE} not found; auth-profile binding field skipped")
    if change_request_supported:
        fields.append(
            field(
                CHANGE_VALIDATION_TABLE,
                "u_change_request",
                "Change Request",
                "reference",
                reference=CHANGE_REQUEST_TABLE,
                max_length=32,
            )
        )
    else:
        print(f"warning {CHANGE_REQUEST_TABLE} not found; change request reference field skipped")
    for item in fields:
        upsert_dictionary_field(client, item)


def ensure_choices(client: ServiceNowClient) -> None:
    choices = [
        (TICKET_TABLE, "u_protocol", "TCP", "TCP", 100),
        (TICKET_TABLE, "u_protocol", "UDP", "UDP", 200),
        (TICKET_TABLE, "u_block_category", "network", "Network", 100),
        (TICKET_TABLE, "u_block_category", "security", "Security", 200),
        (TICKET_TABLE, "u_block_category", "blackhole", "Blackhole", 300),
        (TICKET_TABLE, "u_block_category", "reachability", "Reachability", 400),
        (TICKET_TABLE, "u_block_category", "analysis_error", "Analysis error", 500),
        (TICKET_TABLE, "u_block_category", "unknown", "Unknown", 600),
        (TICKET_TABLE, "u_recommended_team", "network", "Network", 100),
        (TICKET_TABLE, "u_recommended_team", "security", "Security", 200),
        (TICKET_TABLE, "u_recommended_team", "triage", "Triage", 300),
        (TICKET_TABLE, "u_analysis_status", "not_run", "Not run", 100),
        (TICKET_TABLE, "u_analysis_status", "running", "Running", 200),
        (TICKET_TABLE, "u_analysis_status", "complete", "Complete", 300),
        (TICKET_TABLE, "u_analysis_status", "error", "Error", 400),
        (CHANGE_VALIDATION_TABLE, "u_protocol", "TCP", "TCP", 100),
        (CHANGE_VALIDATION_TABLE, "u_protocol", "UDP", "UDP", 200),
        (CHANGE_VALIDATION_TABLE, "u_expected_outcome", "allowed", "Allowed", 100),
        (CHANGE_VALIDATION_TABLE, "u_expected_outcome", "blocked", "Blocked", 200),
        (CHANGE_VALIDATION_TABLE, "u_validation_status", "not_run", "Not run", 100),
        (CHANGE_VALIDATION_TABLE, "u_validation_status", "pass", "Pass", 200),
        (CHANGE_VALIDATION_TABLE, "u_validation_status", "fail", "Fail", 300),
        (CHANGE_VALIDATION_TABLE, "u_validation_status", "error", "Error", 400),
        (CHANGE_VALIDATION_TABLE, "u_block_category", "network", "Network", 100),
        (CHANGE_VALIDATION_TABLE, "u_block_category", "security", "Security", 200),
        (CHANGE_VALIDATION_TABLE, "u_block_category", "blackhole", "Blackhole", 300),
        (CHANGE_VALIDATION_TABLE, "u_block_category", "reachability", "Reachability", 400),
        (CHANGE_VALIDATION_TABLE, "u_block_category", "analysis_error", "Analysis error", 500),
        (CHANGE_VALIDATION_TABLE, "u_block_category", "unknown", "Unknown", 600),
    ]
    for table, element, value, label, sequence in choices:
        payload = {
            "name": table,
            "element": element,
            "value": value,
            "label": label,
            "sequence": str(sequence),
            "language": "en",
            "inactive": "false",
        }
        client.upsert(
            "sys_choice",
            f"name={table}^element={element}^value={value}^language=en",
            payload,
            f"choice {table}.{element}={value}",
        )


def ensure_properties(client: ServiceNowClient, network_id: str, forward_base_url: str) -> None:
    props = {
        "x_fwd_demo.forward.max_results": "1",
        "x_fwd_demo.forward.allowed_base_urls": forward_base_url.rstrip("/") or DEFAULT_FORWARD_BASE_URL,
        "x_fwd_demo.forward.request_timeout_ms": "30000",
        "x_fwd_demo.forward.default_network_id": network_id,
        "x_fwd_demo.cmdb.ci_table": "cmdb_ci_netgear",
        "x_fwd_demo.cmdb.max_cis": "100",
        "x_fwd_demo.tables.ticket": TICKET_TABLE,
        "x_fwd_demo.tables.hop": HOP_TABLE,
        "x_fwd_demo.tables.binding": BINDING_TABLE,
        "x_fwd_demo.tables.change_validation": CHANGE_VALIDATION_TABLE,
        "x_fwd_demo.groups.network": "Network Team",
        "x_fwd_demo.groups.security": "Security Team",
        "x_fwd_demo.groups.triage": "Triage",
    }
    for name, value in props.items():
        client.upsert(
            "sys_properties",
            f"name={name}",
            {"name": name, "value": value, "type": "string", "description": "Forward workflow demo"},
            f"property {name}",
        )


def ensure_groups(client: ServiceNowClient) -> None:
    for name in ("Network Team", "Security Team", "Triage"):
        client.upsert(
            "sys_user_group",
            f"name={name}",
            {"name": name, "active": "true", "description": "Forward workflow demo routing group"},
            f"group {name}",
        )


def ensure_scripts(client: ServiceNowClient) -> None:
    scripts = [
        ("ForwardClient", "ForwardClient.js"),
        ("PathNormalizer", "PathNormalizer.js"),
        ("TicketAnalysis", "TicketAnalysis.js"),
    ]
    for name, filename in scripts:
        client.upsert(
            "sys_script_include",
            f"name={name}",
            {
                "name": name,
                "api_name": name,
                "script": asset(filename),
                "active": "true",
                "client_callable": "false",
                "access": "public",
                "description": "Forward workflow demo helper",
            },
            f"Script Include {name}",
        )


def ensure_event(client: ServiceNowClient) -> None:
    client.upsert(
        "sysevent_register",
        f"event_name={EVENT_NAME}",
        {
            "event_name": EVENT_NAME,
            "table": TICKET_TABLE,
            "description": "Forward demo: analyze connectivity ticket",
            "fired_by": "Forward Workflow Demo",
            "priority": "100",
            "queue": "default",
        },
        f"event {EVENT_NAME}",
    )
    client.upsert(
        "sysevent_script_action",
        f"name=AnalyzeTicket^event_name={EVENT_NAME}",
        {
            "name": "AnalyzeTicket",
            "event_name": EVENT_NAME,
            "active": "true",
            "order": "100",
            "script": asset("AnalyzeTicket_ScriptAction.js"),
        },
        "Script Action AnalyzeTicket",
    )


def ensure_portal(client: ServiceNowClient) -> None:
    widget_sys_id = client.upsert(
        "sp_widget",
        f"name={WIDGET_NAME}",
        {
            "name": WIDGET_NAME,
            "id": WIDGET_ID,
            "template": asset("sp_widget_template.html"),
            "script": asset("sp_widget_server.js"),
            "client_script": asset("sp_widget_client.js"),
            "css": asset("sp_widget_style.css"),
            "controller_as": "c",
            "data_table": "sp_instance",
            "category": "custom",
            "public": "false",
            "description": "Art-of-possible Forward workflow demo for ServiceNow",
        },
        f"widget {WIDGET_NAME}",
    )
    page_sys_id = client.upsert(
        "sp_page",
        f"id={PAGE_ID}",
        {
            "id": PAGE_ID,
            "title": WIDGET_NAME,
            "category": "custom",
            "public": "false",
            "short_description": "Forward workflow demo page",
        },
        f"page {PAGE_ID}",
    )
    container_id = client.upsert(
        "sp_container",
        f"sp_page={page_sys_id}^name={WIDGET_NAME} - Container 100",
        {
            "sp_page": page_sys_id,
            "name": f"{WIDGET_NAME} - Container 100",
            "order": "100",
            "width": "container",
        },
        "portal container",
    )
    row_id = client.upsert(
        "sp_row",
        f"sp_container={container_id}^order=100",
        {"sp_container": container_id, "order": "100"},
        "portal row",
    )
    column_id = client.upsert(
        "sp_column",
        f"sp_row={row_id}^order=100",
        {"sp_row": row_id, "order": "100", "size": "12", "size_lg": "12", "size_sm": "12", "size_xs": "12"},
        "portal column",
    )
    instance_id = client.upsert(
        "sp_instance",
        f"sp_widget={widget_sys_id}^sp_column={column_id}",
        {
            "sp_widget": widget_sys_id,
            "sp_column": column_id,
            "id": "forward_workflow_demo",
            "title": WIDGET_NAME,
            "active": "true",
            "order": "100",
            "size": "md",
        },
        "portal widget instance",
    )
    cleanup_duplicate_widget_instances(
        client,
        page_sys_id,
        forward_widget_sys_ids(client, widget_sys_id),
        instance_id,
    )


def forward_widget_sys_ids(client: ServiceNowClient, canonical_widget_sys_id: str = "") -> list[str]:
    ids = [canonical_widget_sys_id]
    ids.extend(query_ids(client, "sp_widget", f"name={WIDGET_NAME}"))
    ids.extend(query_ids(client, "sp_widget", f"id={WIDGET_ID}"))
    return unique_ids(ids)


def portal_widget_instance_ids(client: ServiceNowClient, page_sys_id: str, widget_sys_ids: list[str]) -> list[str]:
    instance_ids: list[str] = []
    containers = query_ids(client, "sp_container", f"sp_page={page_sys_id}")
    for container_id in containers:
        rows = query_ids(client, "sp_row", f"sp_container={container_id}")
        for row_id in rows:
            columns = query_ids(client, "sp_column", f"sp_row={row_id}")
            for column_id in columns:
                for widget_sys_id in widget_sys_ids:
                    instance_ids.extend(
                        query_ids(client, "sp_instance", f"sp_column={column_id}^sp_widget={widget_sys_id}")
                    )
    return unique_ids(instance_ids)


def cleanup_duplicate_widget_instances(
    client: ServiceNowClient,
    page_sys_id: str,
    widget_sys_ids: list[str],
    keep_instance_id: str,
) -> None:
    for instance_id in portal_widget_instance_ids(client, page_sys_id, widget_sys_ids):
        if instance_id != keep_instance_id:
            delete_record(client, "sp_instance", instance_id, "portal widget instance")


def ensure_tenant_binding(
    client: ServiceNowClient,
    forward_base_url: str,
    forward_username: str,
    forward_password: str,
    auth_profile_sys_id: str,
    tenant_username: str,
) -> None:
    if not auth_profile_sys_id and (not forward_username or not forward_password):
        print("skipped tenant binding: no Forward credentials or auth profile supplied")
        return
    if auth_profile_sys_id and not table_exists(client, AUTH_PROFILE_TABLE):
        raise ServiceNowError(f"{AUTH_PROFILE_TABLE} not found; cannot bind auth profile {auth_profile_sys_id}")
    payload = {
        "u_tenant_username": tenant_username,
        "u_forward_base_url": forward_base_url.rstrip("/"),
        "u_forward_username": forward_username if not auth_profile_sys_id else "",
        "u_forward_password": forward_password if not auth_profile_sys_id else "",
    }
    if auth_profile_sys_id and table_exists(client, AUTH_PROFILE_TABLE):
        payload["u_forward_auth_profile"] = auth_profile_sys_id
    client.upsert(
        BINDING_TABLE,
        f"u_tenant_username={tenant_username}",
        payload,
        f"tenant binding {tenant_username}",
    )


def existing_auth_profile_binding(client: ServiceNowClient, tenant_username: str) -> bool:
    if not table_exists(client, AUTH_PROFILE_TABLE):
        return False
    rows = client.query(
        BINDING_TABLE,
        f"u_tenant_username={tenant_username}",
        fields="sys_id,u_forward_auth_profile,u_forward_username,u_forward_password",
    )
    if not rows:
        return False
    return bool(scalar(rows[0].get("u_forward_auth_profile")))


def assert_production_binding(client: ServiceNowClient, tenant_username: str) -> None:
    rows = client.query(
        BINDING_TABLE,
        f"u_tenant_username={tenant_username}",
        fields="sys_id,u_forward_auth_profile,u_forward_username,u_forward_password",
    )
    if not rows:
        raise ServiceNowError(f"production mode requires tenant binding for {tenant_username}")
    row = rows[0]
    if not scalar(row.get("u_forward_auth_profile")):
        raise ServiceNowError(f"production mode requires u_forward_auth_profile for {tenant_username}")
    if scalar(row.get("u_forward_username")) or scalar(row.get("u_forward_password")):
        raise ServiceNowError(f"production mode refuses direct Forward credentials on {tenant_username}")


def get_forward_credentials() -> tuple[str, str]:
    user = env("FORWARD_USERNAME")
    password = env("FORWARD_PASSWORD")
    if user and password:
        return user, password
    token_file = env("FORWARD_TOKEN_FILE")
    if token_file:
        return parse_forward_token_file(Path(token_file).expanduser())
    return "", ""


def verify(client: ServiceNowClient) -> None:
    fields = "sys_id,name,label"
    for table in (TICKET_TABLE, HOP_TABLE, BINDING_TABLE, CHANGE_VALIDATION_TABLE):
        if not client.query("sys_db_object", f"name={table}", fields=fields):
            raise ServiceNowError(f"verification failed: missing table {table}")
    if not client.query("sysevent_register", f"event_name={EVENT_NAME}", fields="sys_id,event_name"):
        raise ServiceNowError(f"verification failed: missing event {EVENT_NAME}")
    page_rows = client.query("sp_page", f"id={PAGE_ID}", fields="sys_id,id")
    widget_sys_ids = forward_widget_sys_ids(client)
    if not page_rows:
        raise ServiceNowError(f"verification failed: missing portal page {PAGE_ID}")
    if not widget_sys_ids:
        raise ServiceNowError(f"verification failed: missing widget {WIDGET_NAME}")
    instance_ids = portal_widget_instance_ids(client, str(page_rows[0]["sys_id"]), widget_sys_ids)
    if len(instance_ids) != 1:
        raise ServiceNowError(
            f"verification failed: expected 1 portal widget instance for {PAGE_ID}, found {len(instance_ids)}"
        )
    page = fetch_sp_page(client, PAGE_ID)
    widgets = extract_widgets(page)
    if not widgets:
        raise ServiceNowError("verification failed: portal page has no widgets")
    widget = widgets[0].get("widget") or {}
    data = widget.get("data") if isinstance(widget, dict) else {}
    if isinstance(data, dict) and data.get("error"):
        raise ServiceNowError(f"verification failed: widget init error: {data['error']}")
    networks = data.get("networks", []) if isinstance(data, dict) else []
    cis = data.get("cis", []) if isinstance(data, dict) else []
    print(f"verified portal init: networks={len(networks)} cis={len(cis)}")


def fetch_sp_page(client: ServiceNowClient, page_id: str) -> dict[str, Any]:
    endpoint = "/sp_page_probe"
    url = client.instance_url + "/api/now/sp/page?" + urllib.parse.urlencode({"id": page_id})
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", client.auth_header)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60, context=client.ssl_context) as resp:
            payload = json.loads(resp.read().decode(errors="replace"))
            return payload.get("result", {}) if isinstance(payload, dict) else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise ServiceNowError(f"GET {endpoint} failed: HTTP {exc.code}: {body.strip()}") from exc


def extract_widgets(page: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for container in page.get("containers", []) or []:
        for row in container.get("rows", []) or []:
            for column in row.get("columns", []) or []:
                out.extend(column.get("widgets", []) or [])
    return out


def main() -> int:
    instance_url = require_env("SN_INSTANCE_URL").rstrip("/")
    sn_username = require_env("SN_USERNAME")
    sn_password = require_env("SN_PASSWORD")
    forward_base_url = env("FORWARD_BASE_URL", DEFAULT_FORWARD_BASE_URL)
    network_id = env("NETWORK_ID", DEFAULT_NETWORK_ID)
    tenant_username = env("SN_TENANT_USERNAME", sn_username)
    dry_run = truthy(env("DRY_RUN"))
    production_mode = truthy(env(PRODUCTION_MODE_ENV))
    forward_username, forward_password = get_forward_credentials()
    auth_profile_sys_id = env("SN_FORWARD_AUTH_PROFILE_SYS_ID")

    client = ServiceNowClient(instance_url, sn_username, sn_password, dry_run=dry_run)
    print(f"ServiceNow instance: {instance_url}")
    print(f"Tenant binding user: {tenant_username}")

    ensure_tables(client)
    ensure_fields(client)
    ensure_choices(client)
    ensure_properties(client, network_id, forward_base_url)
    ensure_groups(client)
    ensure_scripts(client)
    ensure_event(client)
    ensure_portal(client)
    if production_mode and (forward_username or forward_password) and not auth_profile_sys_id:
        raise ServiceNowError(
            f"{PRODUCTION_MODE_ENV}=1 refuses FORWARD_USERNAME/FORWARD_PASSWORD; "
            "set SN_FORWARD_AUTH_PROFILE_SYS_ID instead"
        )
    if production_mode and not auth_profile_sys_id and not existing_auth_profile_binding(client, tenant_username):
        raise ServiceNowError(f"{PRODUCTION_MODE_ENV}=1 requires SN_FORWARD_AUTH_PROFILE_SYS_ID")
    ensure_tenant_binding(
        client,
        forward_base_url,
        forward_username,
        forward_password,
        auth_profile_sys_id,
        tenant_username,
    )
    if production_mode:
        assert_production_binding(client, tenant_username)
    if not dry_run:
        verify(client)
    print("ServiceNow demo install complete")
    print(f"Portal URL: {instance_url}/sp?id={PAGE_ID}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ServiceNowError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
