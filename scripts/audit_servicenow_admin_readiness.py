#!/usr/bin/env python3
"""Audit ServiceNow admin readiness for the Forward field integration.

The audit is read-only and redacts credential values. It is meant for SNOW
admins before enabling this in a production-managed instance.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any

from install_servicenow_demo import (
    AUTH_PROFILE_TABLE,
    ASSURANCE_API_ID,
    ASSURANCE_BASE_URI_PROPERTY,
    ASSURANCE_RESOURCE_PATH,
    ASSURANCE_WRITER_ROLE,
    BINDING_TABLE,
    CHANGE_REQUEST_TABLE,
    CHANGE_ASSURANCE_TABLE,
    CHANGE_VALIDATION_TABLE,
    DEFAULT_FORWARD_BASE_URL,
    HOP_TABLE,
    PAGE_ID,
    TICKET_TABLE,
    WIDGET_NAME,
    ServiceNowClient,
    env,
    extract_widgets,
    fetch_sp_page,
    forward_widget_sys_ids,
    portal_widget_instance_ids,
    require_env,
    scalar,
    table_exists,
)


SCRIPT_INCLUDES = (
    "ForwardClient",
    "PathNormalizer",
    "TicketAnalysis",
    "ChangeAssuranceContract",
    "ChangeAssuranceService",
    "ChangeAssuranceFlowClient",
)
REQUIRED_TABLES = (TICKET_TABLE, HOP_TABLE, BINDING_TABLE, CHANGE_VALIDATION_TABLE, CHANGE_ASSURANCE_TABLE)
PLATFORM_TABLES = ("incident", CHANGE_REQUEST_TABLE, AUTH_PROFILE_TABLE)


def ok_bool(value: Any) -> bool:
    return str(value).lower() in {"true", "1", "yes"}


def check(report: dict[str, Any], severity: str, name: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"severity": severity, "name": name, "ok": ok, "detail": detail})
    if not ok:
        report["summary"][severity + "s"] += 1


def property_value(client: ServiceNowClient, name: str) -> str:
    rows = client.query("sys_properties", f"name={name}", fields="name,value")
    if not rows:
        return ""
    return scalar(rows[0].get("value"))


def dictionary_type(client: ServiceNowClient, table: str, element: str) -> str:
    rows = client.query("sys_dictionary", f"name={table}^element={element}", fields="internal_type")
    if not rows:
        return ""
    return scalar(rows[0].get("internal_type"))


def audit_tables(client: ServiceNowClient, report: dict[str, Any]) -> None:
    for table in REQUIRED_TABLES:
        check(report, "failure", f"table {table}", table_exists(client, table), "required package table")
    for table in PLATFORM_TABLES:
        check(report, "failure", f"platform table {table}", table_exists(client, table), "required ServiceNow table")


def audit_properties(client: ServiceNowClient, report: dict[str, Any]) -> None:
    allowed = property_value(client, "x_fwd_demo.forward.allowed_base_urls")
    timeout = property_value(client, "x_fwd_demo.forward.request_timeout_ms")
    default_network = property_value(client, "x_fwd_demo.forward.default_network_id")
    assurance_table = property_value(client, "x_fwd_demo.tables.change_assurance")
    max_payload = property_value(client, "x_fwd_demo.assurance.max_payload_bytes")
    worker_base_url = property_value(client, "x_fwd_demo.assurance.worker_base_url").rstrip("/")
    worker_allowed = property_value(client, "x_fwd_demo.assurance.worker_allowed_base_urls")
    worker_auth_profile = property_value(client, "x_fwd_demo.assurance.worker_auth_profile")
    worker_timeout = property_value(client, "x_fwd_demo.assurance.worker_timeout_ms")
    worker_max_payload = property_value(client, "x_fwd_demo.assurance.worker_max_payload_bytes")

    allowed_items = [item.strip().rstrip("/") for item in allowed.split(",") if item.strip()]
    allowed_ok = bool(allowed_items) and all(item.startswith("https://") and "*" not in item for item in allowed_items)
    check(report, "failure", "Forward API allowlist", allowed_ok, allowed or "missing")
    check(report, "warning", "Forward API allowlist default", DEFAULT_FORWARD_BASE_URL in allowed_items, allowed or "missing")

    try:
        timeout_int = int(timeout)
    except ValueError:
        timeout_int = 0
    check(report, "failure", "Forward API timeout", 1000 <= timeout_int <= 60000, timeout or "missing")
    check(report, "warning", "default network id", default_network.isdigit(), default_network or "missing")
    check(
        report,
        "failure",
        "change assurance table property",
        assurance_table == CHANGE_ASSURANCE_TABLE,
        assurance_table or "missing",
    )
    try:
        max_payload_int = int(max_payload)
    except ValueError:
        max_payload_int = 0
    check(
        report,
        "failure",
        "assurance evidence payload bound",
        16384 <= max_payload_int <= 1048576,
        max_payload or "missing",
    )
    if not worker_base_url:
        check(report, "warning", "assurance Flow Designer worker", False, "not configured")
        return
    worker_allowed_items = [item.strip().rstrip("/") for item in worker_allowed.split(",") if item.strip()]
    check(
        report,
        "failure",
        "assurance worker TLS and allowlist",
        worker_base_url.startswith("https://") and worker_base_url in worker_allowed_items and "*" not in worker_allowed,
        worker_base_url,
    )
    auth_rows = client.query(AUTH_PROFILE_TABLE, f"sys_id={worker_auth_profile}", fields="sys_id", limit=2)
    check(
        report,
        "failure",
        "assurance worker auth profile",
        bool(re.fullmatch(r"[0-9a-f]{32}", worker_auth_profile)) and len(auth_rows) == 1,
        "configured" if auth_rows else "missing",
    )
    try:
        worker_timeout_int = int(worker_timeout)
    except ValueError:
        worker_timeout_int = 0
    check(
        report,
        "failure",
        "assurance worker timeout",
        1000 <= worker_timeout_int <= 120000,
        worker_timeout or "missing",
    )
    try:
        worker_max_payload_int = int(worker_max_payload)
    except ValueError:
        worker_max_payload_int = 0
    check(
        report,
        "failure",
        "assurance worker payload bound",
        16384 <= worker_max_payload_int <= 1048576,
        worker_max_payload or "missing",
    )


def audit_assurance_contract(client: ServiceNowClient, report: dict[str, Any]) -> None:
    tables = client.query(
        "sys_db_object",
        f"name={CHANGE_ASSURANCE_TABLE}",
        fields="sys_id,name,ws_access",
    )
    direct_web_service_access = bool(tables) and ok_bool(tables[0].get("ws_access"))
    check(
        report,
        "failure",
        "assurance table direct web-service access disabled",
        bool(tables) and not direct_web_service_access,
        "disabled" if tables and not direct_web_service_access else "enabled or missing",
    )
    fields = client.query(
        "sys_dictionary",
        f"name={CHANGE_ASSURANCE_TABLE}^element=u_idempotency_key",
        fields="internal_type,max_length,unique",
    )
    exists = bool(fields)
    check(report, "failure", "assurance idempotency field", exists, "u_idempotency_key")
    if not fields:
        return
    row = fields[0]
    unique = ok_bool(row.get("unique"))
    check(report, "failure", "assurance idempotency uniqueness", unique, "unique" if unique else "not unique")
    check(
        report,
        "failure",
        "assurance idempotency length",
        scalar(row.get("max_length")) == "128",
        scalar(row.get("max_length")) or "missing",
    )
    for element in (
        "u_forward_assurance_run_id",
        "u_forward_assurance_status",
        "u_forward_assurance_decision",
    ):
        rows = client.query(
            "sys_dictionary",
            f"name={CHANGE_REQUEST_TABLE}^element={element}",
            fields="element,internal_type,max_length",
        )
        check(
            report,
            "failure",
            f"Change Request flow field {element}",
            bool(rows),
            element if rows else "missing",
        )


def audit_bindings(client: ServiceNowClient, report: dict[str, Any]) -> None:
    rows = client.query(
        BINDING_TABLE,
        "sys_idISNOTEMPTY",
        fields="sys_id,u_tenant_username,u_forward_auth_profile,u_forward_username,u_forward_password,u_forward_base_url",
        limit=200,
    )
    check(report, "failure", "tenant bindings", bool(rows), f"{len(rows)} binding row(s)")

    direct_credential_users: list[str] = []
    missing_profile_users: list[str] = []
    for row in rows:
        tenant = scalar(row.get("u_tenant_username")) or scalar(row.get("sys_id"))
        has_profile = bool(scalar(row.get("u_forward_auth_profile")))
        has_direct = bool(scalar(row.get("u_forward_username")) or scalar(row.get("u_forward_password")))
        if not has_profile:
            missing_profile_users.append(tenant)
        if has_direct:
            direct_credential_users.append(tenant)

    check(
        report,
        "failure",
        "bindings use auth profiles",
        not missing_profile_users,
        ", ".join(missing_profile_users) if missing_profile_users else "all bindings have auth profiles",
    )
    check(
        report,
        "failure",
        "no direct Forward secrets in binding table",
        not direct_credential_users,
        ", ".join(direct_credential_users) if direct_credential_users else "direct credential fields blank",
    )

    password_type = dictionary_type(client, BINDING_TABLE, "u_forward_password")
    password_type_detail = password_type or "field missing"
    if direct_credential_users:
        password_type_detail += "; direct credential fields present"
    else:
        password_type_detail += "; direct credential fields blank"
    check(
        report,
        "warning",
        "legacy password field unused or encrypted",
        password_type in {"", "password2"} or not direct_credential_users,
        password_type_detail,
    )


def audit_portal(client: ServiceNowClient, report: dict[str, Any]) -> None:
    pages = client.query("sp_page", f"id={PAGE_ID}", fields="sys_id,id,public")
    check(report, "failure", "portal page exists", bool(pages), PAGE_ID)
    if not pages:
        return

    page_sys_id = scalar(pages[0].get("sys_id"))
    check(report, "failure", "portal page not public", not ok_bool(pages[0].get("public")), PAGE_ID)

    widgets = client.query("sp_widget", f"name={WIDGET_NAME}", fields="sys_id,name,public", limit=20)
    check(report, "failure", "widget exists", bool(widgets), WIDGET_NAME)
    for widget in widgets:
        check(report, "failure", "widget not public", not ok_bool(widget.get("public")), scalar(widget.get("name")))

    instance_ids = portal_widget_instance_ids(client, page_sys_id, forward_widget_sys_ids(client))
    check(report, "failure", "single portal widget instance", len(instance_ids) == 1, f"{len(instance_ids)} instance(s)")


def audit_scripts(client: ServiceNowClient, report: dict[str, Any]) -> None:
    for name in SCRIPT_INCLUDES:
        rows = client.query("sys_script_include", f"name={name}", fields="name,active")
        active = bool(rows) and ok_bool(rows[0].get("active"))
        check(report, "failure", f"Script Include {name}", active, "active" if active else "missing/inactive")


def audit_assurance_api(client: ServiceNowClient, report: dict[str, Any]) -> None:
    roles = client.query("sys_user_role", f"name={ASSURANCE_WRITER_ROLE}", fields="sys_id,name")
    check(report, "failure", "assurance writer role", bool(roles), ASSURANCE_WRITER_ROLE)

    apis = client.query(
        "sys_ws_definition",
        f"service_id={ASSURANCE_API_ID}",
        fields="sys_id,service_id,base_uri,active",
    )
    active_api = bool(apis) and ok_bool(apis[0].get("active"))
    check(report, "failure", "assurance Scripted REST API", active_api, ASSURANCE_API_ID)
    if not apis:
        return
    api_sys_id = scalar(apis[0].get("sys_id"))
    base_uri = scalar(apis[0].get("base_uri")).rstrip("/")
    configured_base_uri = property_value(client, ASSURANCE_BASE_URI_PROPERTY).rstrip("/")
    check(
        report,
        "failure",
        "assurance ingress base URI",
        base_uri.startswith("/api/") and configured_base_uri == base_uri,
        configured_base_uri or "missing",
    )
    operations = client.query(
        "sys_ws_operation",
        f"web_service_definition={api_sys_id}^http_method=POST^relative_path={ASSURANCE_RESOURCE_PATH}",
        fields="sys_id,active,requires_authentication,relative_path,http_method",
    )
    active_operation = bool(operations) and ok_bool(operations[0].get("active"))
    authenticated = bool(operations) and ok_bool(operations[0].get("requires_authentication"))
    check(report, "failure", "assurance evidence REST resource", active_operation, ASSURANCE_RESOURCE_PATH)
    check(report, "failure", "assurance evidence requires authentication", authenticated, "required")


def audit_portal_init(client: ServiceNowClient, report: dict[str, Any]) -> None:
    page = fetch_sp_page(client, PAGE_ID)
    widgets = extract_widgets(page)
    check(report, "failure", "portal API widget count", len(widgets) == 1, f"{len(widgets)} widget(s)")
    if not widgets:
        return
    data = ((widgets[0].get("widget") or {}).get("data") or {}) if isinstance(widgets[0], dict) else {}
    status = data.get("status") if isinstance(data, dict) else {}
    binding_error = scalar((status or {}).get("bindingError")) if isinstance(status, dict) else ""
    networks = data.get("networks") if isinstance(data, dict) else []
    cis = data.get("cis") if isinstance(data, dict) else []
    check(report, "failure", "Forward binding ready", not binding_error, binding_error or "ready")
    check(report, "failure", "Forward networks visible", bool(networks), f"{len(networks or [])} network(s)")
    check(report, "warning", "CMDB CIs visible", bool(cis), f"{len(cis or [])} CI(s)")
    check(
        report,
        "failure",
        "Change validation ready",
        bool(isinstance(status, dict) and status.get("changeValidationTableReady")),
        "u_forward_change_validation",
    )


def print_text(report: dict[str, Any]) -> None:
    for item in report["checks"]:
        state = "PASS" if item["ok"] else item["severity"].upper()
        print(f"{state} {item['name']}: {item['detail']}")
    summary = report["summary"]
    print(
        f"SUMMARY failures={summary['failures']} warnings={summary['warnings']} "
        f"checks={len(report['checks'])}"
    )


def main() -> int:
    json_mode = "--json" in sys.argv
    instance_url = require_env("SN_INSTANCE_URL").rstrip("/")
    sn_username = require_env("SN_USERNAME")
    sn_password = require_env("SN_PASSWORD")
    client = ServiceNowClient(instance_url, sn_username, sn_password)

    report: dict[str, Any] = {
        "instance_url": instance_url,
        "summary": {"failures": 0, "warnings": 0},
        "checks": [],
    }
    audit_tables(client, report)
    audit_properties(client, report)
    audit_bindings(client, report)
    audit_portal(client, report)
    audit_scripts(client, report)
    audit_assurance_contract(client, report)
    audit_assurance_api(client, report)
    audit_portal_init(client, report)

    if json_mode:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_text(report)
    return 2 if report["summary"]["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
