#!/usr/bin/env python3
"""Install or update the Forward ServiceNow field integration.

The installer is intentionally idempotent. It uses ServiceNow's Table API to
create missing schema records and patch existing integration records in place.
"""

from __future__ import annotations

import base64
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


TICKET_TABLE = "u_forward_connectivity_ticket"
HOP_TABLE = "u_forward_connectivity_hop"
BINDING_TABLE = "u_forward_tenant_binding"
CHANGE_VALIDATION_TABLE = "u_forward_change_validation"
CHANGE_ASSURANCE_TABLE = "u_forward_change_assurance"
WIDGET_NAME = "Forward Field Integration"
WIDGET_ID = "forward-workflow-demo"
LEGACY_WIDGET_NAMES = ("Forward Workflow Demo",)
PAGE_ID = "connectivity_ticket"
EVENT_NAME = "x_fwd_demo.analyze_ticket"
ASSURANCE_WRITER_ROLE = "x_fwd_demo.assurance_writer"
ASSURANCE_API_NAME = "Forward Change Assurance"
ASSURANCE_API_ID = "forward_change_assurance"
ASSURANCE_RESOURCE_PATH = "/changes/{change_sys_id}/evidence"
ASSURANCE_BASE_URI_PROPERTY = "x_fwd_demo.assurance.ingress_base_uri"
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


def parse_json_response(method: str, endpoint: str, status: int, body: str) -> Any:
    if not body.strip():
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        hint = (
            "the instance may be hibernating or authentication may have redirected to sign-in"
            if status == 200
            else "ServiceNow did not return the expected JSON error document"
        )
        raise ServiceNowError(
            f"{method} {endpoint} returned HTTP {status} with a non-JSON response; {hint}"
        ) from exc


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
        attempts = 3 if method == "GET" else 1
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(req, timeout=60, context=self.ssl_context) as resp:
                    body = resp.read().decode(errors="replace")
                    parsed = parse_json_response(method, endpoint, resp.status, body)
                    return resp.status, parsed, body
            except urllib.error.HTTPError as exc:
                body = exc.read().decode(errors="replace")
                if exc.code in ok_statuses:
                    parsed = parse_json_response(method, endpoint, exc.code, body)
                    return exc.code, parsed, body
                raise ServiceNowError(f"{method} {endpoint} failed: HTTP {exc.code}: {body.strip()}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt + 1 < attempts:
                    time.sleep(2**attempt)
                    continue
                reason = getattr(exc, "reason", exc)
                raise ServiceNowError(f"{method} {endpoint} failed after {attempts} attempts: {reason}") from exc
        raise AssertionError("unreachable ServiceNow request state")

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
        (CHANGE_ASSURANCE_TABLE, "Forward Change Assurance", task_id),
    ]
    for name, label, super_class in definitions:
        payload = {
            "name": name,
            "label": label,
            "access": "public",
            "read_access": "true",
            # Assurance writes must pass through the authenticated, role-gated,
            # checksummed Scripted REST resource rather than the generic Table API.
            "ws_access": "false" if name == CHANGE_ASSURANCE_TABLE else "true",
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
    unique: bool = False,
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
    if unique:
        payload["unique"] = "true"
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
        field(CHANGE_ASSURANCE_TABLE, "u_run_id", "Assurance Run ID", "string", max_length=255),
        field(
            CHANGE_ASSURANCE_TABLE,
            "u_idempotency_key",
            "Idempotency Key",
            "string",
            max_length=128,
            unique=True,
        ),
        field(CHANGE_ASSURANCE_TABLE, "u_deployment_id", "Deployment ID", "string", max_length=255),
        field(CHANGE_ASSURANCE_TABLE, "u_service_entity_ids", "Dynatrace Service Entity IDs", "string", max_length=4000),
        field(CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "Lifecycle State", "choice", default="received", choice="1"),
        field(CHANGE_ASSURANCE_TABLE, "u_decision", "Gate Decision", "choice", choice="1"),
        field(CHANGE_ASSURANCE_TABLE, "u_reason_codes", "Reason Codes", "string", max_length=4000),
        field(CHANGE_ASSURANCE_TABLE, "u_forward_network_id", "Forward Network ID", "string", max_length=255),
        field(CHANGE_ASSURANCE_TABLE, "u_before_snapshot_id", "Before Snapshot ID", "string", max_length=255),
        field(CHANGE_ASSURANCE_TABLE, "u_after_snapshot_id", "After Snapshot ID", "string", max_length=255),
        field(CHANGE_ASSURANCE_TABLE, "u_reconciliation_run_id", "Reconciliation Run ID", "string", max_length=255),
        field(CHANGE_ASSURANCE_TABLE, "u_reconciliation_state", "Reconciliation State", "string", max_length=64),
        field(CHANGE_ASSURANCE_TABLE, "u_dynatrace_deployment_state", "Dynatrace Deployment State", "string", max_length=64),
        field(CHANGE_ASSURANCE_TABLE, "u_dynatrace_service_health", "Dynatrace Service Health", "string", max_length=64),
        field(CHANGE_ASSURANCE_TABLE, "u_dynatrace_open_problem_count", "Dynatrace Open Problem Count", "integer"),
        field(CHANGE_ASSURANCE_TABLE, "u_preflight_sha256", "Preflight SHA-256", "string", max_length=64),
        field(CHANGE_ASSURANCE_TABLE, "u_gate_sha256", "Gate SHA-256", "string", max_length=64),
        field(CHANGE_ASSURANCE_TABLE, "u_evidence_sha256", "Evidence SHA-256", "string", max_length=64),
        field(CHANGE_ASSURANCE_TABLE, "u_generated_at", "Evidence Generated At", "glide_date_time"),
        field(
            CHANGE_ASSURANCE_TABLE,
            "u_attachment",
            "Evidence Attachment",
            "reference",
            reference="sys_attachment",
            max_length=32,
        ),
        field(CHANGE_ASSURANCE_TABLE, "u_work_note_marker", "Work Note Marker", "string", max_length=128),
        field(CHANGE_ASSURANCE_TABLE, "u_publication_status", "Publication Status", "choice", default="pending", choice="1"),
        field(CHANGE_ASSURANCE_TABLE, "u_publication_error", "Publication Error", "string", max_length=4000),
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
        fields.extend(
            [
                field(
                    CHANGE_REQUEST_TABLE,
                    "u_forward_assurance_run_id",
                    "Forward Assurance Run ID",
                    "string",
                    max_length=64,
                ),
                field(
                    CHANGE_REQUEST_TABLE,
                    "u_forward_assurance_status",
                    "Forward Assurance Status",
                    "choice",
                    default="not_started",
                    choice="1",
                ),
                field(
                    CHANGE_REQUEST_TABLE,
                    "u_forward_assurance_decision",
                    "Forward Assurance Decision",
                    "choice",
                    default="pending",
                    choice="1",
                ),
            ]
        )
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
        fields.append(
            field(
                CHANGE_ASSURANCE_TABLE,
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
        (CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "received", "Received", 100),
        (CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "baseline_pending", "Baseline pending", 200),
        (CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "baseline_captured", "Baseline captured", 300),
        (CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "waiting", "Waiting for completion", 400),
        (CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "evidence_received", "Evidence received", 500),
        (CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "complete", "Complete", 600),
        (CHANGE_ASSURANCE_TABLE, "u_lifecycle_state", "error", "Error", 700),
        (CHANGE_ASSURANCE_TABLE, "u_decision", "pass", "Pass", 100),
        (CHANGE_ASSURANCE_TABLE, "u_decision", "warn", "Warn", 200),
        (CHANGE_ASSURANCE_TABLE, "u_decision", "fail", "Fail", 300),
        (CHANGE_ASSURANCE_TABLE, "u_publication_status", "pending", "Pending", 100),
        (CHANGE_ASSURANCE_TABLE, "u_publication_status", "attachment_ready", "Attachment ready", 200),
        (CHANGE_ASSURANCE_TABLE, "u_publication_status", "published", "Published", 300),
        (CHANGE_ASSURANCE_TABLE, "u_publication_status", "error", "Error", 400),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "not_started", "Not started", 100),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "start-queued", "Start queued", 200),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "start-running", "Start running", 300),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "baseline-captured", "Baseline captured", 400),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "complete-queued", "Complete queued", 500),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "complete-running", "Complete running", 600),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "completed", "Completed", 700),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "blocked", "Blocked", 800),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_status", "failed", "Failed", 900),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_decision", "pending", "Pending", 100),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_decision", "pass", "Pass", 200),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_decision", "warn", "Warn", 300),
        (CHANGE_REQUEST_TABLE, "u_forward_assurance_decision", "fail", "Fail", 400),
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


def ensure_properties(
    client: ServiceNowClient,
    network_id: str,
    forward_base_url: str,
    assurance_worker_base_url: str = "",
    assurance_worker_auth_profile: str = "",
) -> None:
    worker_base_url = assurance_worker_base_url.rstrip("/")
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
        "x_fwd_demo.tables.change_assurance": CHANGE_ASSURANCE_TABLE,
        "x_fwd_demo.assurance.max_payload_bytes": "262144",
        "x_fwd_demo.assurance.writer_role": ASSURANCE_WRITER_ROLE,
        ASSURANCE_BASE_URI_PROPERTY: "",
        "x_fwd_demo.assurance.worker_base_url": worker_base_url,
        "x_fwd_demo.assurance.worker_allowed_base_urls": worker_base_url,
        "x_fwd_demo.assurance.worker_auth_profile": assurance_worker_auth_profile,
        "x_fwd_demo.assurance.worker_timeout_ms": "30000",
        "x_fwd_demo.assurance.worker_max_payload_bytes": "524288",
        "x_fwd_demo.groups.network": "Network Team",
        "x_fwd_demo.groups.security": "Security Team",
        "x_fwd_demo.groups.triage": "Triage",
    }
    for name, value in props.items():
        client.upsert(
            "sys_properties",
            f"name={name}",
            {"name": name, "value": value, "type": "string", "description": "Forward ServiceNow field integration"},
            f"property {name}",
        )


def ensure_groups(client: ServiceNowClient) -> None:
    for name in ("Network Team", "Security Team", "Triage"):
        client.upsert(
            "sys_user_group",
            f"name={name}",
            {"name": name, "active": "true", "description": "Forward ServiceNow field integration routing group"},
            f"group {name}",
        )


def ensure_roles(client: ServiceNowClient) -> None:
    client.upsert(
        "sys_user_role",
        f"name={ASSURANCE_WRITER_ROLE}",
        {
            "name": ASSURANCE_WRITER_ROLE,
            "description": "May submit bounded Forward/Dynatrace change-assurance evidence",
        },
        f"role {ASSURANCE_WRITER_ROLE}",
    )


def ensure_scripts(client: ServiceNowClient) -> None:
    scripts = [
        ("ForwardClient", "ForwardClient.js"),
        ("PathNormalizer", "PathNormalizer.js"),
        ("TicketAnalysis", "TicketAnalysis.js"),
        ("ChangeAssuranceContract", "ChangeAssuranceContract.js"),
        ("ChangeAssuranceService", "ChangeAssuranceService.js"),
        ("ChangeAssuranceFlowClient", "ChangeAssuranceFlowClient.js"),
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
                "description": "Forward ServiceNow field integration helper",
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
            "description": "Forward field integration: analyze connectivity ticket",
            "fired_by": WIDGET_NAME,
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


def ensure_assurance_api(client: ServiceNowClient) -> str:
    api_sys_id = client.upsert(
        "sys_ws_definition",
        f"service_id={ASSURANCE_API_ID}",
        {
            "name": ASSURANCE_API_NAME,
            "service_id": ASSURANCE_API_ID,
            "active": "true",
            "short_description": "Authenticated Forward/Dynatrace change-assurance evidence ingress",
            "consumes": "application/json",
            "produces": "application/json",
        },
        f"Scripted REST API {ASSURANCE_API_NAME}",
    )
    client.upsert(
        "sys_ws_operation",
        f"web_service_definition={api_sys_id}^http_method=POST^relative_path={ASSURANCE_RESOURCE_PATH}",
        {
            "web_service_definition": api_sys_id,
            "name": "Ingest change assurance evidence",
            "http_method": "POST",
            "relative_path": ASSURANCE_RESOURCE_PATH,
            "operation_script": asset("ChangeAssuranceIngest_Resource.js"),
            "active": "true",
            "requires_authentication": "true",
            "consumes": "application/json",
            "produces": "application/json",
            "short_description": "Validate and idempotently publish one bounded assurance evidence bundle",
        },
        "Scripted REST resource ingest change assurance evidence",
    )
    definitions = client.query(
        "sys_ws_definition",
        f"sys_id={api_sys_id}",
        fields="sys_id,base_uri",
        limit=2,
    )
    base_uri = scalar(definitions[0].get("base_uri")) if len(definitions) == 1 else ""
    if base_uri.startswith("/api/"):
        client.upsert(
            "sys_properties",
            f"name={ASSURANCE_BASE_URI_PROPERTY}",
            {
                "name": ASSURANCE_BASE_URI_PROPERTY,
                "value": base_uri.rstrip("/"),
                "type": "string",
                "description": "Authoritative ServiceNow Scripted REST base URI for assurance feedback",
            },
            f"property {ASSURANCE_BASE_URI_PROPERTY}",
        )
    return base_uri.rstrip("/")


def ensure_portal(client: ServiceNowClient) -> None:
    widget_sys_id = client.upsert(
        "sp_widget",
        f"id={WIDGET_ID}",
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
            "description": "Forward ServiceNow field integration",
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
            "short_description": "Forward ServiceNow field integration page",
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
    for legacy_name in LEGACY_WIDGET_NAMES:
        ids.extend(query_ids(client, "sp_widget", f"name={legacy_name}"))
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
    for table in (TICKET_TABLE, HOP_TABLE, BINDING_TABLE, CHANGE_VALIDATION_TABLE, CHANGE_ASSURANCE_TABLE):
        table_rows = client.query("sys_db_object", f"name={table}", fields=fields + ",ws_access")
        if not table_rows:
            raise ServiceNowError(f"verification failed: missing table {table}")
        if table == CHANGE_ASSURANCE_TABLE and truthy(scalar(table_rows[0].get("ws_access"))):
            raise ServiceNowError("verification failed: change assurance table allows direct web-service access")
    if not client.query("sysevent_register", f"event_name={EVENT_NAME}", fields="sys_id,event_name"):
        raise ServiceNowError(f"verification failed: missing event {EVENT_NAME}")
    if not client.query("sys_user_role", f"name={ASSURANCE_WRITER_ROLE}", fields="sys_id,name"):
        raise ServiceNowError(f"verification failed: missing role {ASSURANCE_WRITER_ROLE}")
    api_rows = client.query(
        "sys_ws_definition",
        f"service_id={ASSURANCE_API_ID}",
        fields="sys_id,service_id,base_uri,active",
    )
    if not api_rows:
        raise ServiceNowError(f"verification failed: missing Scripted REST API {ASSURANCE_API_ID}")
    api_sys_id = str(api_rows[0].get("sys_id") or "")
    authoritative_base_uri = scalar(api_rows[0].get("base_uri"))
    if not client.query(
        "sys_ws_operation",
        f"web_service_definition={api_sys_id}^http_method=POST^relative_path={ASSURANCE_RESOURCE_PATH}",
        fields="sys_id,active,requires_authentication",
    ):
        raise ServiceNowError("verification failed: missing change assurance evidence resource")
    base_uri_property = client.query(
        "sys_properties",
        f"name={ASSURANCE_BASE_URI_PROPERTY}",
        fields="sys_id,name,value",
    )
    if (
        len(base_uri_property) != 1
        or not authoritative_base_uri.startswith("/api/")
        or scalar(base_uri_property[0].get("value")) != authoritative_base_uri.rstrip("/")
    ):
        raise ServiceNowError("verification failed: assurance ingress base URI property is not authoritative")
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
    assurance_worker_base_url = env("SN_ASSURANCE_WORKER_BASE_URL")
    assurance_worker_auth_profile = env("SN_ASSURANCE_WORKER_AUTH_PROFILE_SYS_ID")

    if assurance_worker_base_url and not assurance_worker_base_url.startswith("https://"):
        raise ServiceNowError("SN_ASSURANCE_WORKER_BASE_URL must use https")
    if assurance_worker_base_url and not re.fullmatch(r"[0-9a-f]{32}", assurance_worker_auth_profile):
        raise ServiceNowError(
            "SN_ASSURANCE_WORKER_AUTH_PROFILE_SYS_ID must be a 32-character sys_id when the worker is configured"
        )

    client = ServiceNowClient(instance_url, sn_username, sn_password, dry_run=dry_run)
    print(f"ServiceNow instance: {instance_url}")
    print(f"Tenant binding user: {tenant_username}")

    ensure_tables(client)
    ensure_fields(client)
    ensure_choices(client)
    ensure_properties(
        client,
        network_id,
        forward_base_url,
        assurance_worker_base_url,
        assurance_worker_auth_profile,
    )
    ensure_groups(client)
    ensure_roles(client)
    ensure_scripts(client)
    ensure_event(client)
    assurance_base_uri = ensure_assurance_api(client)
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
    print("ServiceNow field integration install complete")
    if assurance_base_uri:
        print(f"Assurance ingress base URI: {assurance_base_uri}")
    print(f"Portal URL: {instance_url}/sp?id={PAGE_ID}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ServiceNowError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
