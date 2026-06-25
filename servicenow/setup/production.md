# Production Readiness Notes

This package is still demo scaffolding, but these settings make it safer for a production-style pilot. Use `admin-runbook.md` as the operational checklist.

## Credentials

Preferred:

1. Create a ServiceNow Basic Auth Profile for the Forward API access key and secret.
2. Run `scripts/install_servicenow_demo.py` with `SN_PRODUCTION_MODE=1` and `SN_FORWARD_AUTH_PROFILE_SYS_ID` set to that profile sys_id.
3. Rotate Forward credentials by updating the ServiceNow auth profile, not the tenant binding row.

Production mode refuses `FORWARD_USERNAME` / `FORWARD_PASSWORD` fallback credentials and verifies that the tenant binding uses `u_forward_auth_profile`.

Fallback:

- If `SN_FORWARD_AUTH_PROFILE_SYS_ID` is not set, the installer stores credentials in `u_forward_tenant_binding`.
- New installs use a two-way encrypted password field for `u_forward_password`.
- Existing string fields are not type-migrated automatically; recreate the field during a controlled ServiceNow change window.

## Network Egress

- Keep `x_fwd_demo.forward.allowed_base_urls` to the exact Forward API origins the instance should call.
- Default is `https://fwd.app/api`.
- Keep `x_fwd_demo.forward.request_timeout_ms` bounded. Default is `30000`.

## Change Control

- Change Request validation writes concise Forward evidence to `change_request.work_notes`.
- It also creates `u_forward_change_validation` records for audit and reporting.
- Use the validation result as an approval signal, not an automatic approval.

## Forward Verification

Run:

```bash
npm run verify:forward
```

Set `PUSH_CMDB=1` only when you intentionally want to trigger a CMDB sync from Forward.

## ServiceNow Verification

Run:

```bash
npm run audit:servicenow
npm run verify:servicenow
```

Set `SN_VERIFY_CHANGE_NUMBER` to include Change Request validation in the browser proof.

The audit is read-only and should be part of every install, upgrade, credential rotation, and portal layout change.

## Access Control

- Keep the Service Portal page and widget non-public.
- Review ACLs for `u_forward_connectivity_ticket`, `u_forward_connectivity_hop`, `u_forward_tenant_binding`, and `u_forward_change_validation` before broad rollout.
- Limit tenant binding writes to ServiceNow admins or the owning platform team.
- Treat `u_forward_change_validation` and linked Change Request work notes as audit evidence.

## Rollback

1. Remove or disable the portal widget instance.
2. Disable Script Action `AnalyzeTicket`.
3. Disable the Forward Basic Auth Profile.
4. Preserve ticket and validation records until retention owners approve deletion.
