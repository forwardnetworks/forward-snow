from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import audit_servicenow_admin_readiness as audit  # noqa: E402


class PropertyClient:
    def __init__(self, properties: dict[str, str]) -> None:
        self.properties = properties

    def query(
        self,
        table: str,
        query: str,
        *,
        fields: str = "sys_id",
        limit: int = 1,
    ) -> list[dict[str, Any]]:
        if table == "sys_properties":
            name = query.removeprefix("name=")
            value = self.properties.get(name)
            return [] if value is None else [{"name": name, "value": value}]
        if table == audit.AUTH_PROFILE_TABLE and query == f"sys_id={'a' * 32}":
            return [{"sys_id": "a" * 32}]
        return []


def report() -> dict[str, Any]:
    return {"checks": [], "summary": {"failures": 0, "warnings": 0}}


def base_properties() -> dict[str, str]:
    return {
        "x_fwd_demo.forward.allowed_base_urls": audit.DEFAULT_FORWARD_BASE_URL,
        "x_fwd_demo.forward.request_timeout_ms": "30000",
        "x_fwd_demo.forward.default_network_id": "235937",
        "x_fwd_demo.tables.change_assurance": audit.CHANGE_ASSURANCE_TABLE,
        "x_fwd_demo.assurance.max_payload_bytes": "262144",
        "x_fwd_demo.assurance.worker_base_url": "https://worker.example.com",
        "x_fwd_demo.assurance.worker_allowed_base_urls": "https://worker.example.com",
        "x_fwd_demo.assurance.worker_auth_profile": "a" * 32,
        "x_fwd_demo.assurance.worker_timeout_ms": "30000",
        "x_fwd_demo.assurance.worker_max_payload_bytes": "524288",
    }


class AuditReadinessTests(unittest.TestCase):
    def test_assurance_api_requires_authoritative_base_uri_property(self) -> None:
        class AssuranceApiClient:
            def __init__(self, configured_base_uri: str) -> None:
                self.configured_base_uri = configured_base_uri

            def query(
                self,
                table: str,
                query: str,
                *,
                fields: str = "sys_id",
                limit: int = 1,
            ) -> list[dict[str, Any]]:
                if table == "sys_user_role":
                    return [{"sys_id": "role", "name": audit.ASSURANCE_WRITER_ROLE}]
                if table == "sys_ws_definition":
                    return [{
                        "sys_id": "api",
                        "service_id": audit.ASSURANCE_API_ID,
                        "base_uri": "/api/tenant_namespace/forward_change_assurance",
                        "active": "true",
                    }]
                if table == "sys_properties":
                    return [{"name": audit.ASSURANCE_BASE_URI_PROPERTY, "value": self.configured_base_uri}]
                if table == "sys_ws_operation":
                    return [{"sys_id": "operation", "active": "true", "requires_authentication": "true"}]
                return []

        ready = report()
        audit.audit_assurance_api(
            AssuranceApiClient("/api/tenant_namespace/forward_change_assurance"),  # type: ignore[arg-type]
            ready,
        )
        self.assertEqual(ready["summary"]["failures"], 0)

        mismatched = report()
        audit.audit_assurance_api(
            AssuranceApiClient("/api/now/forward_change_assurance"),  # type: ignore[arg-type]
            mismatched,
        )
        self.assertEqual(mismatched["summary"]["failures"], 1)

    def test_purchase_free_worker_configuration_passes(self) -> None:
        result = report()
        audit.audit_properties(PropertyClient(base_properties()), result)  # type: ignore[arg-type]
        worker_checks = [item for item in result["checks"] if "assurance worker" in item["name"]]
        self.assertTrue(worker_checks)
        self.assertTrue(all(item["ok"] for item in worker_checks))

    def test_unconfigured_worker_is_warning_only(self) -> None:
        properties = base_properties()
        properties["x_fwd_demo.assurance.worker_base_url"] = ""
        result = report()
        audit.audit_properties(PropertyClient(properties), result)  # type: ignore[arg-type]
        self.assertEqual(result["summary"]["failures"], 0)
        self.assertEqual(result["summary"]["warnings"], 1)

    def test_worker_rejects_non_tls_or_missing_auth_profile(self) -> None:
        properties = base_properties()
        properties["x_fwd_demo.assurance.worker_base_url"] = "http://worker.example.com"
        properties["x_fwd_demo.assurance.worker_allowed_base_urls"] = "http://worker.example.com"
        properties["x_fwd_demo.assurance.worker_auth_profile"] = ""
        result = report()
        audit.audit_properties(PropertyClient(properties), result)  # type: ignore[arg-type]
        self.assertGreaterEqual(result["summary"]["failures"], 2)

    def test_worker_rejects_unbounded_payload_configuration(self) -> None:
        properties = base_properties()
        properties["x_fwd_demo.assurance.worker_max_payload_bytes"] = "99999999"
        result = report()
        audit.audit_properties(PropertyClient(properties), result)  # type: ignore[arg-type]
        payload_checks = [item for item in result["checks"] if item["name"] == "assurance worker payload bound"]
        self.assertEqual(len(payload_checks), 1)
        self.assertFalse(payload_checks[0]["ok"])

    def test_assurance_table_requires_direct_web_service_access_to_be_disabled(self) -> None:
        class ContractClient:
            def __init__(self, ws_access: str) -> None:
                self.ws_access = ws_access

            def query(
                self,
                table: str,
                query: str,
                *,
                fields: str = "sys_id",
                limit: int = 1,
            ) -> list[dict[str, Any]]:
                if table == "sys_db_object":
                    return [{"sys_id": "table", "ws_access": self.ws_access}]
                if table == "sys_dictionary" and "u_idempotency_key" in query:
                    return [{"internal_type": "string", "max_length": "128", "unique": "true"}]
                if table == "sys_dictionary":
                    return [{"element": query.split("element=")[-1], "internal_type": "string"}]
                return []

        ready = report()
        audit.audit_assurance_contract(ContractClient("false"), ready)  # type: ignore[arg-type]
        self.assertEqual(ready["summary"]["failures"], 0)

        exposed = report()
        audit.audit_assurance_contract(ContractClient("true"), exposed)  # type: ignore[arg-type]
        self.assertEqual(exposed["summary"]["failures"], 1)


if __name__ == "__main__":
    unittest.main()
