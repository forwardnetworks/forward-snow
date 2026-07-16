from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import install_servicenow_demo as installer  # noqa: E402


MANIFEST = json.loads((ROOT / "servicenow" / "scoped-app" / "migration-map.json").read_text())
MODEL = json.loads((ROOT / "servicenow" / "scoped-app" / "application-model.json").read_text())


class CaptureClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], str]] = []

    def upsert(self, table: str, query: str, payload: dict[str, object], label: str) -> str:
        self.calls.append((table, query, payload, label))
        return "sys_id"


class ScopedAppMigrationContractTests(unittest.TestCase):
    def test_permanent_scope_is_not_guessed(self) -> None:
        application = MANIFEST["application"]
        self.assertIsNone(application["permanentScope"])
        self.assertTrue(application["scopeRequirements"]["registeredVendorPrefixRequired"])
        self.assertEqual(application["externalDistribution"], "servicenow-store")

    def test_every_installer_table_has_an_explicit_disposition(self) -> None:
        expected = {
            installer.TICKET_TABLE,
            installer.HOP_TABLE,
            installer.BINDING_TABLE,
            installer.CHANGE_VALIDATION_TABLE,
            installer.CHANGE_ASSURANCE_TABLE,
        }
        actual = {entry["source"] for entry in MANIFEST["legacyTables"]}
        self.assertEqual(actual, expected)

    def test_every_installer_property_has_an_explicit_disposition(self) -> None:
        client = CaptureClient()
        installer.ensure_properties(client, "network-1", "https://fwd.app/api")  # type: ignore[arg-type]
        expected = {
            str(payload["name"])
            for table, _query, payload, _label in client.calls
            if table == "sys_properties"
        }
        actual = {entry["source"] for entry in MANIFEST["legacyProperties"]}
        self.assertEqual(actual, expected)

    def test_legacy_credentials_are_never_copied(self) -> None:
        binding = next(
            entry for entry in MANIFEST["legacyTables"] if entry["source"] == installer.BINDING_TABLE
        )
        self.assertFalse(binding["copyData"])
        self.assertEqual(binding["disposition"], "replace_without_data_copy")
        self.assertFalse(MANIFEST["migrationSafety"]["copyCredentialValues"])

    def test_change_assurance_evidence_is_retained_without_concurrent_writers(self) -> None:
        migrated = {
            entry["source"]: entry
            for entry in MANIFEST["legacyTables"]
            if entry["disposition"] == "copy_then_read_only"
        }
        self.assertEqual(
            set(migrated),
            {installer.CHANGE_ASSURANCE_TABLE, installer.CHANGE_VALIDATION_TABLE},
        )
        self.assertTrue(all(entry["retentionClass"] == "audit_evidence" for entry in migrated.values()))
        self.assertFalse(MANIFEST["migrationSafety"]["allowConcurrentWriters"])
        self.assertFalse(MANIFEST["migrationSafety"]["deleteLegacyRecordsAutomatically"])

    def test_target_contract_contains_no_demo_namespace(self) -> None:
        target_text = json.dumps(
            {
                "application": MANIFEST["application"],
                "logicalTargets": [
                    entry.get("logicalTarget")
                    for group in (
                        "legacyTables",
                        "changeRequestCorrelation",
                        "legacyProperties",
                        "legacyMetadata",
                    )
                    for entry in MANIFEST[group]
                ],
            }
        )
        self.assertNotIn("x_fwd_demo", target_text)

    def test_scope_remains_pending_until_build_partner_registration(self) -> None:
        identity = MODEL["identity"]
        self.assertIsNone(identity["vendorPrefix"])
        self.assertIsNone(identity["scope"])
        self.assertEqual(identity["scopeStatus"], "pending_build_partner_registration")

    def test_customer_app_has_native_change_assurance_components(self) -> None:
        self.assertEqual(
            {entry["logicalName"] for entry in MODEL["flowActions"]},
            {
                "start_change_assurance",
                "get_change_assurance_status",
                "complete_change_assurance",
            },
        )
        self.assertEqual(
            {entry["logicalName"] for entry in MODEL["tables"]},
            {"assurance_ledger", "path_validation"},
        )
        self.assertEqual(
            {entry["logicalName"] for entry in MODEL["roles"]},
            {"admin", "operator", "evidence_writer", "auditor"},
        )

    def test_application_model_never_packages_credentials_or_paid_spokes(self) -> None:
        self.assertFalse(MODEL["platform"]["runtimeCredentialValuesPackaged"])
        self.assertFalse(MODEL["platform"]["integrationHubSpokesRequired"])
        self.assertTrue(
            all(not alias["credentialValuesPackaged"] for alias in MODEL["connectionAliases"])
        )
        self.assertTrue(all(not prop["secret"] for prop in MODEL["properties"]))

    def test_native_flow_does_not_own_change_execution_or_approval(self) -> None:
        flow = next(entry for entry in MODEL["flows"] if entry["logicalName"] == "forward_change_assurance_gate")
        self.assertFalse(flow["autoApprove"])
        self.assertFalse(flow["autoRemediate"])
        self.assertFalse(flow["changeExecutorOwned"])

    def test_customer_managed_edition_precedes_store_without_faking_an_upgrade(self) -> None:
        editions = {entry["name"]: entry for entry in MODEL["distributionEditions"]}
        self.assertTrue(editions["customer_managed"]["availableBeforeForwardStoreCertification"])
        self.assertEqual(editions["customer_managed"]["scopeOwner"], "customer")
        self.assertEqual(editions["customer_managed"]["promotionChannel"], "customer_application_repository")
        self.assertFalse(editions["forward_store"]["availableBeforeForwardStoreCertification"])
        self.assertFalse(MODEL["storeTransition"]["inPlaceUpgrade"])
        self.assertTrue(MODEL["storeTransition"]["requiresExplicitMigration"])
        self.assertFalse(MODEL["storeTransition"]["copyCredentialValues"])


if __name__ == "__main__":
    unittest.main()
