# Forward ServiceNow Workflow Demo

This is an art-of-possible demo package for ServiceNow. It shows how a ServiceNow-driven workflow could call Forward APIs, enrich ServiceNow CIs, create workflow tickets/incidents, validate Change Requests, and sync CMDB data from a Forward snapshot.

This is not a Forward product feature. Treat it as experimental customer-testable scaffolding.

## Contents

- `servicenow/assets/`: ServiceNow scripts, Service Portal widget assets, and helper classes.
- `servicenow/setup/schema.md`: required ServiceNow tables, fields, choices, and properties.
- `servicenow/setup/install.md`: ServiceNow install checklist.
- `servicenow/setup/production.md`: production-style credential, egress, and verification notes.
- `servicenow/setup/admin-runbook.md`: ServiceNow admin runbook for production-like installs, audits, operations, and rollback.
- `scripts/install_servicenow_demo.py`: idempotent ServiceNow-side schema, asset, portal, and tenant-binding installer.
- `scripts/configure_forward_integrations.py`: standalone Forward-side ticketing and CMDB configuration.
- `scripts/audit_servicenow_admin_readiness.py`: read-only SNOW admin audit for credential, portal, property, table, and init readiness.
- `scripts/verify_forward_integrations.py`: Forward-side proof for ServiceNow ticketing/CMDB status, with optional CMDB push.
- `scripts/verify_servicenow_portal.js`: Playwright browser proof for login, path analysis, workflow ticket creation, and incident creation.

## Production Posture

For production-like installs, create a ServiceNow Basic Auth Profile that contains the Forward API access key and secret, then run the installer with `SN_PRODUCTION_MODE=1` and `SN_FORWARD_AUTH_PROFILE_SYS_ID`. The tenant binding will reference that auth profile instead of storing the Forward secret directly in the demo table.

When `SN_PRODUCTION_MODE=1`, the installer refuses `FORWARD_USERNAME` / `FORWARD_PASSWORD` fallback credentials and verifies that the binding uses an auth profile. Without production mode, the installer keeps the PDI-friendly fallback and writes `FORWARD_USERNAME` / `FORWARD_PASSWORD` into `u_forward_tenant_binding`. New installs create `u_forward_password` as a two-way encrypted ServiceNow password field; existing string fields are left in place and reported with a warning.

Forward calls are restricted to `x_fwd_demo.forward.allowed_base_urls`, defaulting to `https://fwd.app/api`, and use `x_fwd_demo.forward.request_timeout_ms`, defaulting to 30000 ms.

Run `npm run audit:servicenow` after install and after any portal, credential, or property change. The audit is read-only and fails when direct Forward credentials remain in tenant bindings, when the portal has duplicate widget instances, when the widget/page is public, or when Forward init cannot return networks.

## Forward CMDB Contract

By default, the CMDB integration installs an org-scoped Forward NQE query:

`/ServiceNow/Forward Workflow Demo CMDB Netgear CI`

The packaged query is derived from Forward's stock library query `/External/ServiceNow/CMDB Netgear CI`. The demo query converts `Device Type` to a string so a stock ServiceNow PDI can map it to `cmdb_ci_netgear.device_type`. This lets the demo map all 13 CMDB fields without modifying the Forward source tree.

Set `USE_STOCK_NQE=1` to use the unmodified Forward stock query instead. In stock-query mode, the script omits `Device Type` because the stock query emits that column as an enum while a stock ServiceNow PDI exposes `cmdb_ci_netgear.device_type` as a string.

## Quick Start

1. Install or update the ServiceNow-side objects in production mode:

```bash
export SN_INSTANCE_URL='https://devXXXXX.service-now.com'
export SN_USERNAME='admin'
export SN_PASSWORD='...'
export SN_TENANT_USERNAME='admin'
export SN_PRODUCTION_MODE=1
export SN_FORWARD_AUTH_PROFILE_SYS_ID='<sys_auth_profile_basic sys_id>'
export NETWORK_ID='235937'

python3 scripts/install_servicenow_demo.py
```

For PDI-only testing, omit `SN_PRODUCTION_MODE` and use `FORWARD_USERNAME` / `FORWARD_PASSWORD` fallback credentials.

Audit the ServiceNow install:

```bash
npm run audit:servicenow
```

2. Configure Forward ticketing and CMDB:

```bash
export SN_INSTANCE_URL='https://devXXXXX.service-now.com'
export SN_USERNAME='admin'
export SN_PASSWORD='...'
export NETWORK_ID='235937'
export FORWARD_USERNAME='...'
export FORWARD_PASSWORD='...'

python3 scripts/configure_forward_integrations.py
```

You can also set `FORWARD_TOKEN_FILE` instead of `FORWARD_USERNAME` and `FORWARD_PASSWORD` when using a Forward access-key file that contains `Access key` and `Secret key`.

The script is rerunnable. If Forward ticketing already points at a different ServiceNow PDI, the script deletes and recreates the Forward ticketing integration because Forward treats the ServiceNow instance URL as immutable after creation.

Verify Forward-side integration state:

```bash
npm run verify:forward
```

Set `PUSH_CMDB=1` for an intentional CMDB push proof.

Open the Service Portal demo at:

`https://<instance>.service-now.com/sp?id=connectivity_ticket`

3. Verify the live browser flow:

```bash
npm install

export SN_INSTANCE_URL='https://devXXXXX.service-now.com'
export SN_USERNAME='admin'
export SN_PASSWORD='...'
export NETWORK_ID='235937'

npm run verify:servicenow
```

The verifier writes evidence to `output/playwright/servicenow-demo-result.json` and `output/playwright/servicenow-demo-verified.png`. By default it uses Chrome in headless mode and verifies a blocked path from `192.168.100.57` to `203.0.113.10`; override those with `SN_VERIFY_SRC_IP` and `SN_VERIFY_DST_IP` when needed.

To include native Change Request validation in the browser proof, set:

```bash
export SN_VERIFY_CHANGE_NUMBER='CHG0030001'
export SN_VERIFY_EXPECTED_OUTCOME='blocked'
```
