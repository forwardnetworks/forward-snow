# ServiceNow Install Checklist

This checklist is intentionally explicit so the field integration can be installed without depending on internal Forward tooling.

For a normal install, run `scripts/install_servicenow_demo.py` from the package root. It creates or updates the schema, properties, groups, roles, Script Includes, event action, authenticated assurance API, Service Portal widget/page, tenant binding, Change Request validation table, and change-assurance ledger. Use the manual sections below only when installing by hand.

For production-style credential storage, create a ServiceNow Basic Auth Profile for the Forward API access key and secret, then set `SN_PRODUCTION_MODE=1` and `SN_FORWARD_AUTH_PROFILE_SYS_ID` before running the installer. Production mode refuses direct `FORWARD_USERNAME` / `FORWARD_PASSWORD` fallback credentials. Without production mode, the installer uses the lab fallback fields on `u_forward_tenant_binding`.

## 1. Schema

Create the tables, fields, choices, and properties in `schema.md`.

Create these assignment groups if you want routing buttons to resolve groups:

- `Network Team`
- `Security Team`
- `Triage`

## 2. Script Includes

Create these Script Includes from `servicenow/assets/`:

| Name | File |
| --- | --- |
| `ForwardClient` | `ForwardClient.js` |
| `PathNormalizer` | `PathNormalizer.js` |
| `TicketAnalysis` | `TicketAnalysis.js` |
| `ChangeAssuranceContract` | `ChangeAssuranceContract.js` |
| `ChangeAssuranceService` | `ChangeAssuranceService.js` |
| `ChangeAssuranceFlowClient` | `ChangeAssuranceFlowClient.js` |

## 3. Event And Script Action

Create event:

- Name: `x_fwd_demo.analyze_ticket`
- Description: `Forward field integration: analyze connectivity ticket`

Create Script Action:

- Name: `AnalyzeTicket`
- Event name: `x_fwd_demo.analyze_ticket`
- Script: `AnalyzeTicket_ScriptAction.js`

## 4. Service Portal Widget

Create or update a Service Portal widget:

- Name: `Forward Field Integration`
- Template: `sp_widget_template.html`
- CSS: `sp_widget_style.css`
- Client script: `sp_widget_client.js`
- Server script: `sp_widget_server.js`

Create a Service Portal page:

- ID: `connectivity_ticket`
- Title: `Forward Field Integration`

Place the widget on the page. The usual URL is:

`https://<instance>.service-now.com/sp?id=connectivity_ticket`

## 5. Tenant Binding

Create one row in `u_forward_tenant_binding` for each ServiceNow user that will run the widget.

For lab-only fallback testing, the first row is usually:

- `u_tenant_username`: `admin`
- `u_forward_base_url`: `https://fwd.app/api`
- `u_forward_username`: Forward access key or username
- `u_forward_password`: Forward secret or password

For production binding, prefer:

- `u_forward_auth_profile`: sys_id of a ServiceNow Basic Auth Profile for Forward API credentials
- `u_forward_username`: blank
- `u_forward_password`: blank

After install, run:

```bash
npm run audit:servicenow
```

The audit fails if tenant bindings use direct Forward credentials, if the portal page/widget is public, or if duplicate Forward widget instances are present.

## 6. Forward-Side Integrations

Run `scripts/configure_forward_integrations.py` from the package root to enable Forward ticketing and Forward CMDB sync. See `forward-install.md` for the detailed Forward-side workflow.

The script installs or updates the org-scoped Forward NQE query `/ServiceNow/Forward Field Integration CMDB Netgear CI`, derived from the stock Forward CMDB Netgear CI query with `Device Type` converted to a string for broad lab-instance compatibility.

Open the portal at:

`https://<instance>.service-now.com/sp?id=connectivity_ticket`

## 7. Change Request Validation

The portal can validate a selected path against a native `change_request`. It creates a `u_forward_change_validation` task, links it to the Change Request when a number is supplied, writes Forward evidence to the Change Request work notes, and records pass/fail based on the expected outcome.

## 8. Change Assurance Evidence Ingress

Create role `x_fwd_demo.assurance_writer` and assign it only to the bounded Forward-side feedback user. The installer
creates authenticated resource:

```text
POST /api/now/forward_change_assurance/changes/{change_sys_id}/evidence
```

The Script field is `ChangeAssuranceIngest_Resource.js`. It calls `ChangeAssuranceService`, which validates the
aggregate evidence contract, upserts `u_forward_change_assurance` by its unique idempotency key, creates the evidence
attachment, then adds the Change Request work note.

## 9. Purchase-Free Flow Designer Actions

Configure `SN_ASSURANCE_WORKER_BASE_URL` and `SN_ASSURANCE_WORKER_AUTH_PROFILE_SYS_ID` before running the installer,
then follow [flow-designer.md](flow-designer.md). The actions use `ChangeAssuranceFlowClient` from a core Script step;
they do not require the IntegrationHub REST step.
