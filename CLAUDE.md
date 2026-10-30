# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **source kit**, not a runnable app. It generates a customer-owned ServiceNow scoped application ("Forward Change Assurance") built with the ServiceNow SDK and Fluent. The only deployment artifact is that scoped app. There is deliberately no global installer, Update Set installer, demo namespace, portal installer, or separate Forward integration installer; don't add one. See `README.md` for the customer install flow and `docs/` for runbooks.

## Commands

```bash
npm ci
npm run validate          # py_compile scripts/*.py + all tests (what CI runs)
npm test                  # test:contract + test:scoped
npm run test:contract     # node --test tests/*.test.js
npm run test:scoped       # python3 -m unittest discover -s tests -p 'test_*.py'

# single tests
node --test tests/change_assurance_contract.test.js
python3 -m unittest tests.test_materialize_scoped_app
```

Tests are credential-free and make no ServiceNow API calls. CI additionally materializes the app with scope `x_acme_fca` and runs `npm run build` and `npm run build:ci` in the generated project, plus `npm audit --omit=dev --audit-level=high`. To reproduce locally:

```bash
python3 scripts/materialize_servicenow_scoped_app.py --scope x_acme_fca --output /path/outside/repo --install-dependencies
```

## Architecture

The key idea: shared server logic lives once in `servicenow/assets/` as plain JS using `__SCOPE__` placeholders and `u_`-prefixed field names, and `scripts/materialize_servicenow_scoped_app.py` renders it into a generated SDK project.

- `servicenow/assets/ChangeAssurance*.js` — canonical business logic (contract/hash validation, service, flow client, ingest resource, close guard). These are also loaded directly by `tests/change_assurance_contract.test.js` (with a stubbed `GlideDigest`), so they must stay `require`-able in plain Node.
- `servicenow/scoped-app-template/` — Fluent source (`src/fluent/*.now.ts`: tables, roles, ACLs, actions, subflows, close-guard business rule, config) plus `src/server/` handlers and `scripts/verified-build.mjs` (fails closed on compiler/metadata errors). Contains `__SCOPE__` placeholders.
- `scripts/materialize_servicenow_scoped_app.py` — copies the template, substitutes `__SCOPE__`, renders assets into `src/server/*.server.js` (`render_service` rewrites `"u_<field>"` to `"<field>"` for the `ASSURANCE_FIELDS` list; `render_flow_client` does string-block replacement and raises if the expected blocks are not found, so edits to `ChangeAssuranceFlowClient.js` can break generation), pins `SDK_VERSION`, and writes `SCOPED_APP_BUILD.json`.
- `scripts/validate_customer_scope.py` — scope rules: starts with `x_`, ≤18 chars, no `demo`/`test`/`lab`/`sandbox`/`personal`.
- `servicenow/scoped-app/application-model.json` — application contract and release metadata (customer-managed vs. Forward Store editions; Store release is blocked pending a registered vendor prefix).

When adding a field to the audit record, it must be reflected in `ASSURANCE_FIELDS`, the Fluent schema (`schema.now.ts`), and the asset JS.

## Conventions enforced by tests

- Markdown anywhere in the repo (this file included) must not name the Dynatrace integration repository; `tests/documentation_independence.test.js` fails on it, so docs must stand alone.
- No credentials or tokens in the source kit; auth lives in the local SDK config via OAuth alias. `output/` and `.env*` are gitignored.
- Node ≥ 20.18.0 (CI uses 20.18.1), Python 3.12.
