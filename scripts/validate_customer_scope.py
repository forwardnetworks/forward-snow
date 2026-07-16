#!/usr/bin/env python3
"""Validate a customer-owned ServiceNow scope before SDK project creation."""

from __future__ import annotations

import argparse
import re


SCOPE_PATTERN = re.compile(r"^x_[a-z0-9]+(?:_[a-z0-9]+)*$")
MAX_SCOPE_LENGTH = 18
FORBIDDEN_TERMS = frozenset({"demo", "lab", "test", "sandbox", "personal"})
FORBIDDEN_SCOPES = frozenset({"x_fwd_demo"})


def validate_scope(scope: str) -> list[str]:
    errors: list[str] = []
    if len(scope) > MAX_SCOPE_LENGTH:
        errors.append(f"scope must be {MAX_SCOPE_LENGTH} characters or fewer")
    if not SCOPE_PATTERN.fullmatch(scope):
        errors.append("scope must begin with x_ and contain only lowercase letters, digits, and single underscores")
    if scope in FORBIDDEN_SCOPES:
        errors.append("scope is a reserved Forward demo identity")
    terms = set(scope.split("_"))
    rejected = sorted(terms & FORBIDDEN_TERMS)
    if rejected:
        errors.append(f"scope contains non-production term(s): {', '.join(rejected)}")
    if SCOPE_PATTERN.fullmatch(scope) and len(scope.split("_")) < 3:
        errors.append("scope must include both the customer namespace and an application identifier")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scope", help="customer-owned ServiceNow private scope")
    args = parser.parse_args()

    errors = validate_scope(args.scope)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 2
    print(f"valid customer-owned scope: {args.scope}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
