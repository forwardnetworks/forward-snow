from __future__ import annotations

import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import install_servicenow_demo as installer  # noqa: E402


class CaptureClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], str]] = []

    def upsert(self, table: str, query: str, payload: dict[str, object], label: str) -> str:
        self.calls.append((table, query, payload, label))
        return "sys_id"

    def query(self, table: str, query: str, *, fields: str = "sys_id", limit: int = 1) -> list[dict[str, object]]:
        if table == "sys_db_object" and (
            "name=sys_auth_profile_basic" in query
            or "name=change_request" in query
            or "name=task" in query
        ):
            return [{"sys_id": "platform_table"}]
        return []


class InstallerContractTests(unittest.TestCase):
    def test_http_200_html_is_diagnosed_without_echoing_the_response(self) -> None:
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self) -> bytes:
                return b"<html><body>Sign in SECRET-MARKER</body></html>"

        client = installer.ServiceNowClient("https://example.service-now.com", "user", "password")
        with mock.patch.object(installer.urllib.request, "urlopen", return_value=Response()):
            with self.assertRaisesRegex(installer.ServiceNowError, "hibernating or authentication") as raised:
                client.request("GET", "/sys_db_object")
        self.assertNotIn("SECRET-MARKER", str(raised.exception))

    def test_safe_gets_retry_transient_connection_failures(self) -> None:
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self) -> bytes:
                return b'{"result": []}'

        client = installer.ServiceNowClient("https://example.service-now.com", "user", "password")
        failures = [
            urllib.error.URLError(TimeoutError("first timeout")),
            urllib.error.URLError(TimeoutError("second timeout")),
            Response(),
        ]
        with mock.patch.object(installer.urllib.request, "urlopen", side_effect=failures) as urlopen:
            with mock.patch.object(installer.time, "sleep") as sleep:
                status, payload, _body = client.request("GET", "/sys_db_object")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"result": []})
        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_unique_assurance_idempotency_field(self) -> None:
        definition = installer.field(
            installer.CHANGE_ASSURANCE_TABLE,
            "u_idempotency_key",
            "Idempotency Key",
            "string",
            max_length=128,
            unique=True,
        )
        self.assertEqual(definition["unique"], "true")
        self.assertEqual(definition["max_length"], "128")

    def test_assurance_table_disables_direct_web_service_access(self) -> None:
        client = CaptureClient()
        installer.ensure_tables(client)  # type: ignore[arg-type]
        tables = {
            str(payload["name"]): payload
            for table, _query, payload, _label in client.calls
            if table == "sys_db_object"
        }
        self.assertEqual(tables[installer.CHANGE_ASSURANCE_TABLE]["ws_access"], "false")
        self.assertEqual(tables[installer.TICKET_TABLE]["ws_access"], "true")

    def test_assurance_choices_are_installed(self) -> None:
        client = CaptureClient()
        installer.ensure_choices(client)  # type: ignore[arg-type]
        assurance = {
            (payload["element"], payload["value"])
            for table, _query, payload, _label in client.calls
            if table == "sys_choice" and payload["name"] == installer.CHANGE_ASSURANCE_TABLE
        }
        self.assertIn(("u_decision", "pass"), assurance)
        self.assertIn(("u_decision", "warn"), assurance)
        self.assertIn(("u_decision", "fail"), assurance)
        self.assertIn(("u_lifecycle_state", "complete"), assurance)
        self.assertIn(("u_publication_status", "attachment_ready"), assurance)
        change_choices = {
            (payload["element"], payload["value"])
            for table, _query, payload, _label in client.calls
            if table == "sys_choice" and payload["name"] == installer.CHANGE_REQUEST_TABLE
        }
        self.assertIn(("u_forward_assurance_status", "baseline-captured"), change_choices)
        self.assertIn(("u_forward_assurance_decision", "fail"), change_choices)

    def test_assurance_script_includes_are_installed(self) -> None:
        client = CaptureClient()
        installer.ensure_scripts(client)  # type: ignore[arg-type]
        names = {
            str(payload["name"])
            for table, _query, payload, _label in client.calls
            if table == "sys_script_include"
        }
        self.assertIn("ChangeAssuranceContract", names)
        self.assertIn("ChangeAssuranceService", names)
        self.assertIn("ChangeAssuranceFlowClient", names)

    def test_flow_worker_properties_are_installed(self) -> None:
        client = CaptureClient()
        installer.ensure_properties(
            client,  # type: ignore[arg-type]
            "network-1",
            "https://fwd.app/api",
            "https://worker.example.com/",
            "a" * 32,
        )
        properties = {
            str(payload["name"]): payload["value"]
            for table, _query, payload, _label in client.calls
            if table == "sys_properties"
        }
        self.assertEqual(properties["x_fwd_demo.assurance.worker_base_url"], "https://worker.example.com")
        self.assertEqual(properties["x_fwd_demo.assurance.worker_allowed_base_urls"], "https://worker.example.com")
        self.assertEqual(properties["x_fwd_demo.assurance.worker_auth_profile"], "a" * 32)

    def test_assurance_fields_are_installed(self) -> None:
        client = CaptureClient()
        installer.ensure_fields(client)  # type: ignore[arg-type]
        assurance_fields = {
            str(payload["element"]): payload
            for table, _query, payload, _label in client.calls
            if table == "sys_dictionary" and payload["name"] == installer.CHANGE_ASSURANCE_TABLE
        }
        self.assertEqual(assurance_fields["u_change_request"]["reference"], "change_request")
        self.assertEqual(assurance_fields["u_attachment"]["reference"], "sys_attachment")
        self.assertEqual(assurance_fields["u_idempotency_key"]["unique"], "true")
        self.assertIn("u_gate_sha256", assurance_fields)
        self.assertIn("u_dynatrace_service_health", assurance_fields)
        change_fields = {
            str(payload["element"]): payload
            for table, _query, payload, _label in client.calls
            if table == "sys_dictionary" and payload["name"] == installer.CHANGE_REQUEST_TABLE
        }
        self.assertEqual(change_fields["u_forward_assurance_run_id"]["max_length"], "64")
        self.assertEqual(change_fields["u_forward_assurance_status"]["internal_type"], "choice")

    def test_authenticated_assurance_rest_resource_is_installed(self) -> None:
        client = CaptureClient()
        installer.ensure_roles(client)  # type: ignore[arg-type]
        installer.ensure_assurance_api(client)  # type: ignore[arg-type]
        by_table = {table: payload for table, _query, payload, _label in client.calls}
        self.assertEqual(by_table["sys_user_role"]["name"], installer.ASSURANCE_WRITER_ROLE)
        self.assertEqual(by_table["sys_ws_definition"]["service_id"], installer.ASSURANCE_API_ID)
        operation = by_table["sys_ws_operation"]
        self.assertEqual(operation["http_method"], "POST")
        self.assertEqual(operation["relative_path"], installer.ASSURANCE_RESOURCE_PATH)
        self.assertEqual(operation["requires_authentication"], "true")
        self.assertIn("ChangeAssuranceService", str(operation["operation_script"]))

    def test_assurance_assets_are_present(self) -> None:
        self.assertIn("ChangeAssuranceContract", installer.asset("ChangeAssuranceContract.js"))
        self.assertIn("ChangeAssuranceService", installer.asset("ChangeAssuranceService.js"))
        self.assertIn("ChangeAssuranceFlowClient", installer.asset("ChangeAssuranceFlowClient.js"))
        self.assertIn("assurance writer role is required", installer.asset("ChangeAssuranceIngest_Resource.js"))


if __name__ == "__main__":
    unittest.main()
