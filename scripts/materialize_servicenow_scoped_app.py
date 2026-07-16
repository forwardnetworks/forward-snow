#!/usr/bin/env python3
"""Create a customer-owned ServiceNow SDK project from the scoped-app kit."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

from validate_customer_scope import validate_scope


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT / "servicenow" / "scoped-app-template"
ASSET_ROOT = ROOT / "servicenow" / "assets"
SDK_VERSION = "4.8.1"
APP_NAME = "Forward Change Assurance"
PACKAGE_NAME = "forward-change-assurance"

ASSURANCE_FIELDS = (
    "change_request",
    "run_id",
    "idempotency_key",
    "deployment_id",
    "service_entity_ids",
    "lifecycle_state",
    "decision",
    "reason_codes",
    "forward_network_id",
    "before_snapshot_id",
    "after_snapshot_id",
    "reconciliation_run_id",
    "reconciliation_state",
    "dynatrace_deployment_state",
    "dynatrace_service_health",
    "dynatrace_open_problem_count",
    "preflight_sha256",
    "gate_sha256",
    "evidence_sha256",
    "generated_at",
    "attachment",
    "work_note_marker",
    "publication_status",
    "publication_error",
)


def render_template(text: str, scope: str) -> str:
    return text.replace("__SCOPE__", scope)


def render_service(scope: str) -> str:
    text = (ASSET_ROOT / "ChangeAssuranceService.js").read_text()
    text = text.replace(
        'gs.getProperty("x_fwd_demo.assurance.max_payload_bytes", "262144")',
        f'gs.getProperty("{scope}.assurance.max_payload_bytes", "262144")',
    )
    text = text.replace(
        'return String(gs.getProperty("x_fwd_demo.tables.change_assurance", "u_forward_change_assurance"));',
        f'return "{scope}_assurance";',
    )
    for field in ASSURANCE_FIELDS:
        text = text.replace(f'"u_{field}"', f'"{field}"')
    return text


def render_ingest(scope: str) -> str:
    text = (ASSET_ROOT / "ChangeAssuranceIngest_Resource.js").read_text()
    text = re.sub(
        r'var requiredRole = String\(gs\.getProperty\([^;]+;',
        f'var requiredRole = "{scope}.evidence_writer";',
        text,
        count=1,
    )
    return text


def render_flow_client(scope: str) -> str:
    text = (ASSET_ROOT / "ChangeAssuranceFlowClient.js").read_text()
    initialize = f'''initialize: function () {{
    this._aliasName = "Forward Change Assurance Worker";
    this._timeoutMs = parseInt(gs.getProperty("{scope}.assurance.worker_timeout_ms", "30000"), 10);
    this._maxPayloadBytes = parseInt(gs.getProperty("{scope}.assurance.worker_max_payload_bytes", "524288"), 10);
    var connection = this._connectionInfo();
    this._baseUrl = String(connection.getAttribute("connection_url") || "").replace(/\\/+$/, "");
    this._username = String(connection.getCredentialAttribute("user_name") || "");
    this._password = String(connection.getCredentialAttribute("password") || "");
    this._validateConfiguration();
  }},

  start:'''
    text, count = re.subn(
        r'initialize: function \(\) \{.*?\n  \},\n\n  start:',
        initialize,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError("could not replace ChangeAssuranceFlowClient initialize block")
    text = text.replace(
        'rm.setAuthenticationProfile("basic", this._authProfileSysId);',
        "rm.setBasicAuth(this._username, this._password);",
    )
    configuration = '''_connectionInfo: function () {
    var alias = new GlideRecord("sys_alias");
    alias.addQuery("name", this._aliasName);
    alias.addQuery("sys_scope.scope", "__SCOPE__");
    alias.setLimit(2);
    alias.query();
    if (!alias.next()) throw new Error("assurance worker connection alias is not bound");
    var aliasSysId = String(alias.getUniqueValue() || "");
    if (alias.next()) throw new Error("assurance worker connection alias is ambiguous");
    var info = new sn_cc.ConnectionInfoProvider().getConnectionInfo(aliasSysId);
    if (!info) throw new Error("assurance worker connection alias has no active connection");
    return info;
  },

  _validateConfiguration: function () {
    if (!/^https:\\/\\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(this._baseUrl)) {
      throw new Error("assurance worker connection must be an exact HTTPS origin");
    }
    if (!this._username || !this._password) {
      throw new Error("assurance worker connection alias credential is incomplete");
    }
    if (!isFinite(this._timeoutMs) || this._timeoutMs < 1000 || this._timeoutMs > 120000) {
      throw new Error("assurance worker timeout must be between 1000 and 120000 ms");
    }
    if (!isFinite(this._maxPayloadBytes) || this._maxPayloadBytes < 16384 || this._maxPayloadBytes > 1048576) {
      throw new Error("assurance worker payload limit must be between 16384 and 1048576 bytes");
    }
  },

  _rejectUnsafeContent:'''.replace("__SCOPE__", scope)
    text, count = re.subn(
        r'_validateConfiguration: function \(\) \{.*?\n  \},\n\n  _rejectUnsafeContent:',
        configuration,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError("could not replace ChangeAssuranceFlowClient configuration block")
    if "x_fwd_demo" in text or "worker_auth_profile" in text:
        raise RuntimeError("rendered ChangeAssuranceFlowClient retained demo or auth-profile configuration")
    return text


def write_sdk_sources(output: Path, scope: str) -> None:
    for source in sorted(TEMPLATE_ROOT.rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(TEMPLATE_ROOT)
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(render_template(source.read_text(), scope))

    server = output / "src" / "server"
    server.mkdir(parents=True, exist_ok=True)
    (server / "ChangeAssuranceContract.server.js").write_text(
        (ASSET_ROOT / "ChangeAssuranceContract.js").read_text()
    )
    (server / "ChangeAssuranceService.server.js").write_text(render_service(scope))
    (server / "ChangeAssuranceFlowClient.server.js").write_text(render_flow_client(scope))
    (server / "ChangeAssuranceIngest.server.js").write_text(render_ingest(scope))


def materialize(scope: str, output: Path, *, install_dependencies: bool) -> None:
    errors = validate_scope(scope)
    if errors:
        raise ValueError("; ".join(errors))
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"output directory must be absent or empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            "npx",
            "--yes",
            f"@servicenow/sdk@{SDK_VERSION}",
            "init",
            "--appName",
            APP_NAME,
            "--packageName",
            PACKAGE_NAME,
            "--scopeName",
            scope,
            "--template",
            "typescript.basic",
        ],
        cwd=output,
        check=True,
    )

    for generated_example in (output / "src" / "fluent" / "example.now.ts", output / "src" / "server" / "script.ts"):
        generated_example.unlink(missing_ok=True)
    write_sdk_sources(output, scope)

    package_path = output / "package.json"
    package = json.loads(package_path.read_text())
    package["version"] = "0.1.0"
    package["description"] = "Customer-owned Forward Change Assurance ServiceNow scoped application"
    package["private"] = True
    package["scripts"]["build:raw"] = package["scripts"]["build"]
    package["scripts"]["build"] = "node scripts/verified-build.mjs"
    package_path.write_text(json.dumps(package, indent=2) + "\n")
    (output / "SCOPED_APP_BUILD.json").write_text(
        json.dumps(
            {
                "schemaVersion": "forward-servicenow-scoped-app-build/v1",
                "application": APP_NAME,
                "scope": scope,
                "sdkVersion": SDK_VERSION,
                "sourceKitVersion": "0.1.0",
            },
            indent=2,
        )
        + "\n"
    )
    if install_dependencies:
        subprocess.run(["npm", "install", "--include=dev"], cwd=output, check=True)
        # SDK 4.8.1 assumes the conventional TypeScript declaration directory exists,
        # even when the resolved dependency graph does not create it.
        (output / "node_modules" / "@types").mkdir(parents=True, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", required=True, help="permanent customer-owned ServiceNow scope")
    parser.add_argument("--output", required=True, type=Path, help="new or empty SDK project directory")
    parser.add_argument("--install-dependencies", action="store_true")
    args = parser.parse_args()
    try:
        materialize(args.scope, args.output.expanduser().resolve(), install_dependencies=args.install_dependencies)
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}")
        return 2
    print(f"materialized {APP_NAME} in {args.output}")
    print("next: configure a customer-owned SDK auth alias, then run npm run build and npm run deploy -- --auth <alias>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
