#!/usr/bin/env python3
"""Enable Forward ServiceNow ticketing and CMDB for one network.

This is intentionally standalone so the demo can be installed in a ServiceNow
PDI without depending on internal Forward tooling. CMDB sync is scoped to NETWORK_ID.
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


DEFAULT_FORWARD_BASE_URL = "https://fwd.app/api"
DEFAULT_NETWORK_ID = "235937"
CMDB_CLASS = "cmdb_ci_netgear"
STOCK_CMDB_QUERY_PATH = "/External/ServiceNow/CMDB Netgear CI"
STOCK_CMDB_FALLBACK_QUERY_ID = "FQ_d1336efd5d49c52215e4dbbde013ecbe78d964e7"
DEMO_CMDB_QUERY_PATH = "/ServiceNow/Forward Workflow Demo CMDB Netgear CI"
DEMO_CMDB_QUERY_FILE = "servicenow/nqe/Forward Workflow Demo CMDB Netgear CI"

BASE_CMDB_FIELD_MAP = [
    ("Name", "name"),
    ("Manufacturer", "manufacturer"),
    ("Serial Number", "serial_number"),
    ("Model ID", "model_id"),
    ("Location", "location"),
    ("Fully Qualified Domain Name", "fqdn"),
    ("DNS Domain", "dns_domain"),
    ("IP Address: Management", "ip_address"),
    ("MAC Address: Management", "mac_address"),
    ("Ports", "ports"),
    ("Estimated Bandwidth", "bandwidth"),
    ("Physical Interface Count", "physical_interface_count"),
]
DEVICE_TYPE_FIELD_MAP = ("Device Type", "device_type")


class ForwardError(RuntimeError):
    pass


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def truthy(value: str) -> bool:
    return value.strip() in {"1", "true", "TRUE", "yes", "YES", "on", "ON"}


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


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key.lower() in {"password", "u_forward_password"}:
                out[key] = "<redacted>"
            elif key.lower() in {"username", "u_forward_username"} and isinstance(item, str):
                out[key] = item[:3] + "..." if len(item) > 3 else "<redacted>"
            else:
                out[key] = redact(item)
        return out
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


class ForwardClient:
    def __init__(self, base_url: str, username: str, password: str, dry_run: bool = False) -> None:
        self.base_url = base_url.rstrip("/")
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
        dry_run_response: Any | None = None,
    ) -> tuple[int, Any, str]:
        url = self.base_url + endpoint
        if self.dry_run and method != "GET":
            print(f"DRY-RUN {method} {url}")
            if payload is not None:
                print(json.dumps(redact(payload), indent=2, sort_keys=True))
            return 200, dry_run_response, ""

        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        req.add_header("Authorization", self.auth_header)
        if payload is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30, context=self.ssl_context) as resp:
                body = resp.read().decode(errors="replace")
                parsed = json.loads(body) if body.strip() else None
                return resp.status, parsed, body
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            if exc.code in ok_statuses:
                parsed = json.loads(body) if body.strip() else None
                return exc.code, parsed, body
            raise ForwardError(f"{method} {endpoint} failed: HTTP {exc.code}: {body.strip() or '<empty>'}") from exc


def integration_exists(client: ForwardClient) -> bool:
    exists, _ = integration_settings(client)
    return exists


def integration_settings(client: ForwardClient) -> tuple[bool, str]:
    status, parsed, _ = client.request("GET", "/integrations/servicenow", ok_statuses=(404, 405))
    if status == 404:
        return False, ""
    if status == 405:
        return False, ""
    instance_url = ""
    if isinstance(parsed, dict):
        instance_url = str(parsed.get("instanceUrl") or "").strip()
    return 200 <= status < 300, instance_url


def same_instance_url(a: str, b: str) -> bool:
    a = a.strip().rstrip("/")
    b = b.strip().rstrip("/")
    if not a or not b:
        return True
    return a.lower() == b.lower()


def delete_ticketing(client: ForwardClient) -> None:
    status, _, _ = client.request("DELETE", "/integrations/servicenow", ok_statuses=(404,))
    if status == 404:
        return


def patch_ticketing(client: ForwardClient, payload: dict[str, Any]) -> tuple[int, str]:
    status, _, body = client.request(
        "PATCH",
        "/integrations/servicenow",
        payload,
        ok_statuses=(400, 404, 405),
    )
    if 200 <= status < 300:
        return status, body
    return status, body


def put_ticketing(client: ForwardClient, payload: dict[str, Any]) -> None:
    client.request("PUT", "/integrations/servicenow", payload)


def ticketing_error(status: int, body: str) -> ForwardError:
    msg = body.strip() or "<empty>"
    return ForwardError(f"PATCH /integrations/servicenow failed: HTTP {status}: {msg}")


def enable_ticketing(client: ForwardClient, instance_url: str, username: str, password: str) -> None:
    exists, current_instance_url = integration_settings(client)
    payload = {
        "username": username,
        "password": password,
        "enabled": True,
        "autoCreate": True,
        "autoCreateImpact": "3",
        "autoCreateUrgency": "3",
        "autoUpdate": True,
    }

    include_instance_url = not exists
    if exists and current_instance_url and not same_instance_url(current_instance_url, instance_url):
        print("Forward ticketing points at a different ServiceNow instance; resetting immutable integration")
        delete_ticketing(client)
        include_instance_url = True

    if include_instance_url:
        payload["instanceUrl"] = instance_url

    status, body = patch_ticketing(client, payload)
    if status == 400 and "Update to 'instanceUrl' is not allowed" in body:
        print("Forward rejected an instanceUrl update; resetting immutable integration")
        delete_ticketing(client)
        payload["instanceUrl"] = instance_url
        status, body = patch_ticketing(client, payload)
    if status in {404, 405}:
        put_ticketing(client, payload)
    elif status < 200 or status >= 300:
        raise ticketing_error(status, body)
    print("Forward ticketing configured")


def cmdb_field_map(use_demo_nqe: bool) -> list[tuple[str, str]]:
    fields = list(BASE_CMDB_FIELD_MAP)
    if use_demo_nqe:
        fields.insert(7, DEVICE_TYPE_FIELD_MAP)
    return fields


def discover_stock_cmdb_query_id(client: ForwardClient) -> str:
    _, repo, _ = client.request("GET", "/nqe/repos/fwd/commits/head/queries")
    for query in (repo or {}).get("queries", []):
        path = str(query.get("path", "")).strip()
        query_id = str(query.get("queryId", "")).strip()
        if query_id and (path == STOCK_CMDB_QUERY_PATH or path.endswith(STOCK_CMDB_QUERY_PATH)):
            return query_id
    return STOCK_CMDB_FALLBACK_QUERY_ID


def org_queries(client: ForwardClient) -> list[dict[str, Any]]:
    _, repo, _ = client.request("GET", "/nqe/repos/org/commits/head/queries")
    queries = (repo or {}).get("queries", [])
    return queries if isinstance(queries, list) else []


def find_org_query(client: ForwardClient, query_path: str) -> dict[str, Any] | None:
    for query in org_queries(client):
        if str(query.get("path", "")).strip() == query_path:
            return query if isinstance(query, dict) else None
    return None


def query_params(params: dict[str, str]) -> str:
    return urllib.parse.urlencode(params, safe="/")


def get_committed_org_query_source(client: ForwardClient, query: dict[str, Any], query_path: str) -> str:
    commit_id = str(query.get("lastCommitId") or "head").strip()
    endpoint = (
        "/nqe/repos/org/commits/"
        + urllib.parse.quote(commit_id, safe="")
        + "/queries?"
        + query_params({"path": query_path, "with": "sourceCode"})
    )
    _, parsed, _ = client.request("GET", endpoint, ok_statuses=(404,))
    if isinstance(parsed, dict):
        return str(parsed.get("sourceCode") or "")
    return ""


def nqe_analysis_for_path(client: ForwardClient, query_path: str, snapshot_id: str) -> dict[str, Any]:
    endpoint = "/nqe/repos/org/commits/head/queries?" + query_params({"analysis": "", "snapshotId": snapshot_id})
    _, parsed, _ = client.request("GET", endpoint)
    analyses = (parsed or {}).get("analyses", []) if isinstance(parsed, dict) else []
    for analysis in analyses:
        if isinstance(analysis, dict) and str(analysis.get("path", "")).strip() == query_path:
            return analysis
    raise ForwardError(f"demo NQE analysis not found for {query_path}")


def nqe_type_name(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("type") or value.get("name") or "").strip()
    return str(value or "").strip()


def nqe_parent_directories(query_path: str) -> list[str]:
    parts = [part for part in query_path.strip().split("/") if part]
    dirs: list[str] = []
    prefix = ""
    for part in parts[:-1]:
        prefix += f"/{part}"
        dirs.append(prefix + "/")
    return dirs


def ensure_nqe_directories(client: ForwardClient, query_path: str) -> None:
    for directory in nqe_parent_directories(query_path):
        status, _, body = client.request(
            "POST",
            "/users/current/nqe/changes?" + query_params({"action": "addDir", "path": directory}),
            ok_statuses=(409,),
        )
        body_l = body.lower()
        if status == 409 and "already" not in body_l and "target_already" not in body_l:
            raise ForwardError(f"could not create NQE directory {directory}: {body.strip() or '<empty>'}")


def commit_nqe_changes(client: ForwardClient, paths: list[str], title: str) -> None:
    client.request(
        "POST",
        "/nqe/repos/org/commits",
        {"paths": paths, "message": {"title": title, "body": ""}},
    )


def validate_demo_nqe_analysis(client: ForwardClient, query_path: str, snapshot_id: str) -> None:
    if not snapshot_id:
        print("Warning: skipping demo NQE analysis validation because no processed snapshot was found")
        return
    analysis = nqe_analysis_for_path(client, query_path, snapshot_id)
    if analysis.get("error") or not analysis.get("valid", True):
        raise ForwardError(f"demo NQE analysis failed for {query_path}")
    columns = analysis.get("columns") if isinstance(analysis.get("columns"), dict) else {}
    device_type = nqe_type_name(columns.get("Device Type"))
    if device_type != "String":
        raise ForwardError(f"demo NQE Device Type column is {device_type or '<missing>'}, expected String")


def install_demo_nqe_query(client: ForwardClient, query_path: str, source_file: Path, snapshot_id: str) -> str:
    source = source_file.read_text()
    if client.dry_run:
        print(f"DRY-RUN install/update Forward demo NQE at {query_path}")
        return "OQ_dry_run_forward_servicenow_demo_cmdb"
    ensure_nqe_directories(client, query_path)
    existing = find_org_query(client, query_path)
    if existing:
        current_source = get_committed_org_query_source(client, existing, query_path)
        if current_source.strip() == source.strip():
            print(f"Forward demo NQE already current at {query_path}")
        else:
            basis = {
                "queryId": str(existing.get("queryId") or ""),
                "commitId": str(existing.get("lastCommitId") or ""),
            }
            client.request(
                "POST",
                "/users/current/nqe/changes?" + query_params({"action": "editQuery", "path": query_path}),
                {"sourceCode": source, "basis": basis},
            )
            commit_nqe_changes(client, [query_path], "Update Forward ServiceNow demo CMDB query")
            print(f"Forward demo NQE updated at {query_path}")
    else:
        client.request(
            "POST",
            "/users/current/nqe/changes?" + query_params({"action": "addQuery", "path": query_path}),
            {"sourceCode": source},
        )
        commit_nqe_changes(client, [query_path], "Install Forward ServiceNow demo CMDB query")
        print(f"Forward demo NQE installed at {query_path}")

    query = find_org_query(client, query_path)
    query_id = str((query or {}).get("queryId") or "").strip()
    if not query_id:
        raise ForwardError(f"could not discover org query id for {query_path}")
    validate_demo_nqe_analysis(client, query_path, snapshot_id)
    return query_id


def resolve_cmdb_query_id(client: ForwardClient, use_demo_nqe: bool, snapshot_id: str) -> tuple[str, str]:
    if not use_demo_nqe:
        return discover_stock_cmdb_query_id(client), STOCK_CMDB_QUERY_PATH
    package_root = Path(__file__).resolve().parents[1]
    source_file = Path(env("DEMO_NQE_SOURCE_FILE", str(package_root / DEMO_CMDB_QUERY_FILE))).expanduser()
    query_path = env("DEMO_NQE_PATH", DEMO_CMDB_QUERY_PATH)
    return install_demo_nqe_query(client, query_path, source_file, snapshot_id), query_path


def get_cmdb_schema(
    client: ForwardClient,
    instance_url: str,
    username: str,
    password: str,
    field_map: list[tuple[str, str]],
) -> list[dict[str, Any]]:
    payload = {
        "connectionDetails": {
            "instanceUrl": instance_url,
            "username": username,
            "password": password,
        },
        "classNames": [CMDB_CLASS],
    }
    dry_schema = [
        {
            "name": CMDB_CLASS,
            "fields": [
                {"label": label, "element": element, "dataType": "string", "mandatory": False}
                for label, element in field_map
            ],
        }
    ]
    _, schema, _ = client.request(
        "POST",
        "/integrations/servicenow-cmdb?view=schema",
        payload,
        dry_run_response=dry_schema,
    )
    if not isinstance(schema, list):
        raise ForwardError("CMDB schema response was not a list")
    return schema


def build_relations(schema: list[dict[str, Any]], field_map: list[tuple[str, str]]) -> list[dict[str, Any]]:
    fields = {}
    for item in schema:
        if item.get("name") != CMDB_CLASS:
            continue
        for field in item.get("fields", []):
            element = str(field.get("element", "")).strip()
            if element:
                fields[element] = field

    relations = []
    for column, element in field_map:
        field = fields.get(element)
        if field:
            relations.append({"cmdbField": field, "queryColumnName": column})
    return relations


def enable_cmdb(
    client: ForwardClient,
    network_id: int,
    instance_url: str,
    username: str,
    password: str,
    query_id: str,
    query_path: str,
    field_map: list[tuple[str, str]],
) -> None:
    schema = get_cmdb_schema(client, instance_url, username, password, field_map)
    relations = build_relations(schema, field_map)
    if not relations:
        raise ForwardError(f"{CMDB_CLASS} schema returned no mappable fields")

    connection_details = {
        "instanceUrl": instance_url,
        "username": username,
        "password": password,
    }
    config = {
        "settings": {
            "connectionName": "Forward ServiceNow",
            "connectionDetails": connection_details,
            "sourceName": "Forward",
        },
        "mappings": [
            {
                "name": CMDB_CLASS,
                "queryId": query_id,
                "fieldRelations": relations,
            }
        ],
        "syncConfig": {"networkIds": [str(network_id)]},
        "enabled": False,
    }
    client.request("POST", "/integrations/servicenow-cmdb/configuration", config)
    client.request("POST", "/integrations/servicenow-cmdb?action=enable")
    print(f"Forward CMDB configured for network {network_id} with {len(relations)} mapped fields")
    print(f"CMDB query: {query_path} ({query_id})")


def validate_network(client: ForwardClient, network_id: int) -> str:
    _, snapshots, _ = client.request(f"GET", f"/networks/{network_id}/snapshots?state=PROCESSED&limit=1")
    if isinstance(snapshots, dict):
        rows = snapshots.get("snapshots") or snapshots.get("items") or []
    else:
        rows = snapshots or []
    if not rows:
        print(f"Warning: network {network_id} auth worked, but no processed snapshots were returned")
        return ""
    snapshot_id = str(rows[0].get("id") if isinstance(rows[0], dict) else "")
    print(f"Forward network {network_id} reachable; latest processed snapshot: {snapshot_id}")
    return snapshot_id


def main() -> int:
    forward_user = env("FORWARD_USERNAME")
    forward_pass = env("FORWARD_PASSWORD")
    if not forward_user or not forward_pass:
        token_file = env("FORWARD_TOKEN_FILE")
        if not token_file:
            raise SystemExit("set FORWARD_USERNAME/FORWARD_PASSWORD or FORWARD_TOKEN_FILE")
        forward_user, forward_pass = parse_forward_token_file(Path(token_file).expanduser())

    network_id = int(env("NETWORK_ID", DEFAULT_NETWORK_ID))
    forward_base = env("FORWARD_BASE_URL", DEFAULT_FORWARD_BASE_URL).rstrip("/")
    instance_url = require_env("SN_INSTANCE_URL").rstrip("/")
    sn_username = require_env("SN_USERNAME")
    sn_password = require_env("SN_PASSWORD")
    dry_run = truthy(env("DRY_RUN"))
    use_demo_nqe = not truthy(env("USE_STOCK_NQE"))

    client = ForwardClient(forward_base, forward_user, forward_pass, dry_run=dry_run)
    print(f"Forward API: {forward_base}")
    print(f"Network ID: {network_id}")
    print(f"ServiceNow instance: {instance_url}")

    snapshot_id = validate_network(client, network_id)
    enable_ticketing(client, instance_url, sn_username, sn_password)
    query_id, query_path = resolve_cmdb_query_id(client, use_demo_nqe, snapshot_id)
    enable_cmdb(
        client,
        network_id,
        instance_url,
        sn_username,
        sn_password,
        query_id,
        query_path,
        cmdb_field_map(use_demo_nqe),
    )
    print("ServiceNow ticketing and CMDB scaffold complete")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ForwardError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
