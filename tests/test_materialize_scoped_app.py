from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import materialize_servicenow_scoped_app as materializer  # noqa: E402


class ScopedAppMaterializerTests(unittest.TestCase):
    def test_template_has_no_hardcoded_customer_scope(self) -> None:
        files = [path for path in materializer.TEMPLATE_ROOT.rglob("*") if path.is_file()]
        self.assertTrue(files)
        rendered = "\n".join(
            materializer.render_template(path.read_text(), "x_acme_fca")
            for path in files
        )
        self.assertNotIn("__SCOPE__", rendered)
        self.assertNotIn("demo", rendered.lower())
        self.assertIn("x_acme_fca_assurance", rendered)
        self.assertIn("x_acme_fca.evidence_writer", rendered)
        self.assertIn("Start Forward Change Assurance", rendered)
        self.assertIn("Complete Forward Change Assurance", rendered)
        self.assertIn("Forward Change Assurance - install metadata", rendered)
        self.assertIn("verified build rejected ServiceNow SDK errors", rendered)

    def test_service_uses_scoped_table_and_fields(self) -> None:
        rendered = materializer.render_service("x_acme_fca")
        self.assertIn('return "x_acme_fca_assurance"', rendered)
        self.assertIn('"idempotency_key"', rendered)
        self.assertNotIn("u_forward_change_assurance", rendered)
        self.assertNotIn("demo", rendered.lower())

    def test_ingest_uses_packaged_writer_role(self) -> None:
        rendered = materializer.render_ingest("x_acme_fca")
        self.assertIn('var requiredRole = "x_acme_fca.evidence_writer"', rendered)
        self.assertNotIn("demo", rendered.lower())

    def test_flow_client_resolves_customer_bound_alias(self) -> None:
        rendered = materializer.render_flow_client("x_acme_fca")
        self.assertIn("sn_cc.ConnectionInfoProvider", rendered)
        self.assertIn('alias.addQuery("sys_scope.scope", "x_acme_fca")', rendered)
        self.assertIn("rm.setBasicAuth(this._username, this._password)", rendered)
        self.assertNotIn("worker_auth_profile", rendered)
        self.assertNotIn("demo", rendered.lower())

    def test_dependency_install_includes_sdk_dev_dependencies(self) -> None:
        source = (ROOT / "scripts/materialize_servicenow_scoped_app.py").read_text()
        self.assertIn('["npm", "install", "--include=dev"]', source)
        self.assertIn('"node_modules" / "@types"', source)

    def test_uses_current_local_sdk_and_install_workflow(self) -> None:
        source = (ROOT / "scripts/materialize_servicenow_scoped_app.py").read_text()
        self.assertIn('SDK_VERSION = "4.9.0"', source)
        self.assertIn("npx @servicenow/sdk auth --add", source)
        self.assertIn("npm run build and npm run deploy", source)
        self.assertIn('package["scripts"]["build:ci"] = "now-sdk build --frozenKeys true --errorOnConflict true"', source)
        self.assertIn('package["scripts"]["deploy"] = "now-sdk install --demoData false --reinstall false"', source)

    def test_passes_an_optional_auth_alias_to_sdk_init(self) -> None:
        source = (ROOT / "scripts/materialize_servicenow_scoped_app.py").read_text()
        self.assertIn('parser.add_argument("--auth", default=""', source)
        self.assertIn('init_command.extend(["--auth", auth_alias])', source)


if __name__ == "__main__":
    unittest.main()
