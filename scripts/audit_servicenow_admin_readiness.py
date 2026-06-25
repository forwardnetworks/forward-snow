#!/usr/bin/env python3
"""Audit ServiceNow admin readiness for the Forward workflow package.

The audit is read-only and redacts credential values. It is meant for SNOW
admins before enabling this in a production-like instance.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from install_servicenow_demo import (
    AUTH_PROFILE_TABLE,
    BINDING_TABLE,
    CHANGE_REQUEST_TABLE,
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


SCRIPT_INCLUDES = ("ForwardClient", "PathNormalizer", "TicketAnalysis")
REQUIRED_TABLES = (TICKET_TABLE, HOP_TABLE, BINDING_TABLE, CHANGE_VALIDATION_TABLE)
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
    audit_portal_init(client, report)

    if json_mode:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_text(report)
    return 2 if report["summary"]["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
