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

    def test_forward_client_is_scoped_and_alias_bound(self) -> None:
        rendered = materializer.render_forward_client("x_acme_fca")
        self.assertIn('alias.addQuery("sys_scope.scope", "x_acme_fca")', rendered)
        self.assertIn('gs.getProperty("x_acme_fca.forward.timeout_ms"', rendered)
        self.assertIn("sn_cc.ConnectionInfoProvider", rendered)
        self.assertNotIn("__SCOPE__", rendered)
        self.assertNotIn("demo", rendered.lower())
        source = (ROOT / "scripts/materialize_servicenow_scoped_app.py").read_text()
        self.assertIn('"ForwardApiClient.server.js"', source)

    def test_path_check_targets_the_scoped_validation_table(self) -> None:
        rendered = materializer.render_path_check("x_acme_fca")
        self.assertIn('new GlideRecordSecure("x_acme_fca_validation")', rendered)
        self.assertNotIn("__SCOPE__", rendered)
        self.assertNotIn("demo", rendered.lower())

    def test_maps_lookup_is_scoped_and_read_only(self) -> None:
        rendered = materializer.render_maps_lookup("x_acme_fca")
        self.assertIn('gs.getProperty("x_acme_fca.forward.maps_enabled"', rendered)
        self.assertIn('new GlideRecordSecure("change_request")', rendered)
        self.assertNotIn("__SCOPE__", rendered)
        self.assertNotIn(".update(", rendered)
        self.assertNotIn("demo", rendered.lower())

    def test_predict_script_include_is_rendered_into_the_project_with_the_scope(self) -> None:
        import tempfile

        rendered = materializer.render_predict("x_acme_fca")
        self.assertIn("x_acme_fca.forward.predict_enabled", rendered)
        self.assertNotIn("__SCOPE__", rendered)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            materializer.write_sdk_sources(output, "x_acme_fca")
            written = (output / "src" / "server" / "ForwardPredict.server.js").read_text()
            self.assertEqual(written, rendered)
            for name in ("ForwardPredictCloseRule", "ForwardPredictDeleteRule", "ForwardPredictRevisionRule"):
                rule = (output / "src" / "server" / f"{name}.server.js").read_text()
                self.assertNotIn("__SCOPE__", rule)
            revision = (output / "src" / "server" / "ForwardPredictRevisionRule.server.js").read_text()
            self.assertIn("x_acme_fca_predict_revision", revision)

    def test_scope_id_is_written_to_the_project_config(self) -> None:
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "now.config.json").write_text(
                json.dumps({"scope": "x_acme_fca", "scopeId": "a" * 32, "name": "Forward Change Assurance"})
            )
            materializer.apply_scope_id(output, "efbe4ce9cd7949b18735151bd3916418")
            config = json.loads((output / "now.config.json").read_text())
            self.assertEqual(config["scopeId"], "efbe4ce9cd7949b18735151bd3916418")
            self.assertEqual(config["scope"], "x_acme_fca")
            for bad in ("", "EFBE4CE9CD7949B18735151BD3916418", "efbe", "g" * 32):
                with self.assertRaises(ValueError):
                    materializer.apply_scope_id(output, bad)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                materializer.materialize("x_acme_fca", Path(directory) / "app", install_dependencies=False, scope_id="not-an-id")
            self.assertFalse((Path(directory) / "app").exists())
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "now.config.json").write_text(json.dumps({"scope": "x_acme_fca"}))
            with self.assertRaises(RuntimeError):
                materializer.apply_scope_id(Path(directory), "efbe4ce9cd7949b18735151bd3916418")

    def test_dependency_install_includes_sdk_dev_dependencies(self) -> None:
        source = (ROOT / "scripts/materialize_servicenow_scoped_app.py").read_text()
        self.assertIn('["npm", "install", "--include=dev"]', source)
        self.assertIn('"node_modules" / "@types"', source)

    def test_uses_current_local_sdk_and_install_workflow(self) -> None:
        source = (ROOT / "scripts/materialize_servicenow_scoped_app.py").read_text()
        self.assertIn('SDK_VERSION = "4.14.0"', source)
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
