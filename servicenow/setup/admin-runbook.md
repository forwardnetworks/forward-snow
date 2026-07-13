# ServiceNow Admin Runbook

This runbook is for ServiceNow admins installing the Forward field integration in a production-managed instance.

## Support Boundary

This is field integration code. It is not a supported Forward product, packaged ServiceNow app, or standard Forward platform feature. Operate it through the customer's normal ServiceNow change-control, access-control, and rollback processes.

## Scope

The package installs field integration workflow objects:

- custom task tables for Forward connectivity tickets, path validations, and deployment assurance
- Script Includes that call the Forward API
- authenticated bounded-evidence ingress for the Forward-side conductor
- purchase-free Flow Designer client using core Script steps and an auth profile
- Service Portal page and widget
- routing groups and system properties
- optional Forward ticketing and CMDB integration configuration

It does not auto-approve changes, bypass ServiceNow approvals, or grant users access outside normal ServiceNow controls.

## Required Roles

Use an admin account or an implementation account with rights to manage:

- tables and dictionary fields
- Script Includes and Script Actions
- Service Portal pages, widgets, containers, rows, columns, and instances
- system properties
- Basic Auth Profiles
- assignment groups
- Scripted REST APIs/resources and the `x_fwd_demo.assurance_writer` role

Use a named integration/admin account. Do not use a personal account for long-lived production ownership.

## Credential Model

Production mode requires a ServiceNow Basic Auth Profile for Forward API credentials.

1. Create a Basic Auth Profile named for the Forward tenant, for example `Forward API - Production`.
2. Put the Forward access key in `username`.
3. Put the Forward secret in `password`.
4. Record the auth profile `sys_id`.
5. Run the installer with `SN_PRODUCTION_MODE=1` and `SN_FORWARD_AUTH_PROFILE_SYS_ID=<sys_id>`.

In production mode the installer refuses `FORWARD_USERNAME` / `FORWARD_PASSWORD` fallback credentials and verifies that the tenant binding references an auth profile.

## Install

```bash
export SN_INSTANCE_URL='https://<instance>.service-now.com'
export SN_USERNAME='<admin-or-implementation-user>'
export SN_PASSWORD='<password>'
export SN_TENANT_USERNAME='<ServiceNow user who runs the widget>'
export SN_PRODUCTION_MODE=1
export SN_FORWARD_AUTH_PROFILE_SYS_ID='<sys_auth_profile_basic sys_id>'
export FORWARD_BASE_URL='https://fwd.app/api'
export NETWORK_ID='<default Forward network id>'

python3 scripts/install_servicenow_demo.py
```

Run the installer in a ServiceNow change window. It is idempotent and updates existing package objects in place.

## Verify

Run the ServiceNow admin audit:

```bash
npm run audit:servicenow
```

Required passing checks:

- all package tables exist
- `incident`, `change_request`, and `sys_auth_profile_basic` are available
- Forward API base URL allowlist is HTTPS-only and explicit
- Forward timeout is bounded
- tenant bindings use auth profiles
- tenant binding direct credential fields are blank
- Service Portal page and widget are not public
- exactly one Forward widget instance is on the portal page
- Script Includes are active
- portal init reaches Forward networks
- Change Request validation table is ready
- change-assurance ledger idempotency is unique
- direct web-service access to the change-assurance table is disabled
- assurance API/resource is active and requires authentication
- configured assurance worker origin is HTTPS, exactly allowlisted, and uses a valid Basic Auth Profile
- configured assurance worker request/response payload limit is between 16384 and 1048576 bytes

Run browser verification only from a controlled workstation:

```bash
npm run verify:servicenow
```

Set `SN_VERIFY_CHANGE_NUMBER` to include native Change Request validation.

## Operations

- Rotate Forward credentials in the ServiceNow Basic Auth Profile.
- Keep `x_fwd_demo.forward.allowed_base_urls` pinned to exact Forward API origins.
- Keep `x_fwd_demo.forward.request_timeout_ms` between 1000 and 60000 ms.
- Review `u_forward_change_validation` records and linked Change Request work notes during CAB review.
- Review `u_forward_change_assurance` decision, lineage hashes, attachment, and publication state during CAB review.
- Keep Service Portal page/widget `public=false`.
- Re-run `npm run audit:servicenow` after upgrades, credential rotation, and portal layout edits.

## Rollback

Disable user access first:

1. Remove the widget instance from `sp?id=connectivity_ticket`, or set the page/widget inactive according to local policy.
2. Disable Script Action `AnalyzeTicket`.
3. Disable or remove the Forward Basic Auth Profile.
4. Preserve `u_forward_change_validation`, `u_forward_change_assurance`, and ticket records if they are audit evidence.
5. Remove custom tables only after retention owners approve deletion.

## Known Boundaries

- The package uses `u_` custom tables, not a packaged ServiceNow scoped app.
- ACL design should be reviewed and adjusted by the ServiceNow platform owner before broad rollout.
- The CMDB mapping targets `cmdb_ci_netgear` for broad lab-instance compatibility; production CMDB class mapping should match local CMDB policy.
- Assurance-ledger `choice` fields are written natively by the ServiceNow service. Forward CMDB mapping does not
  directly support `choice`; keep any ServiceNow-side default/flow/transform workaround explicit and separate.
