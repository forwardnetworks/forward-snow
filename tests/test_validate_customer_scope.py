from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_customer_scope import validate_scope  # noqa: E402


class CustomerScopeValidationTests(unittest.TestCase):
    def test_accepts_customer_owned_production_scope(self) -> None:
        self.assertEqual(validate_scope("x_acme_fca"), [])
        self.assertEqual(validate_scope("x_acme_chg_asr"), [])

    def test_rejects_demo_and_disposable_scopes(self) -> None:
        self.assertTrue(validate_scope("x_acme_demo"))
        self.assertTrue(validate_scope("x_acme_lab"))
        self.assertTrue(validate_scope("x_acme_test"))

    def test_rejects_invalid_or_oversized_scopes(self) -> None:
        self.assertTrue(validate_scope("acme_fca"))
        self.assertTrue(validate_scope("x_ACME_fca"))
        self.assertTrue(validate_scope("x_acme__fca"))
        self.assertTrue(validate_scope("x_customer_change_assurance"))

    def test_requires_namespace_and_application_identifier(self) -> None:
        self.assertTrue(validate_scope("x_acme"))


if __name__ == "__main__":
    unittest.main()
