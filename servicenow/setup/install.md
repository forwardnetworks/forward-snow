# ServiceNow Install Checklist

This checklist is intentionally explicit so the demo can be installed in a stock PDI without depending on internal Forward tooling.

For a normal PDI install, run `scripts/install_servicenow_demo.py` from the package root. It creates or updates the schema, properties, groups, Script Includes, event action, Service Portal widget/page, tenant binding, and Change Request validation table. Use the manual sections below only when installing by hand.

For production-style credential storage, create a ServiceNow Basic Auth Profile for the Forward API access key and secret, then set `SN_PRODUCTION_MODE=1` and `SN_FORWARD_AUTH_PROFILE_SYS_ID` before running the installer. Production mode refuses direct `FORWARD_USERNAME` / `FORWARD_PASSWORD` fallback credentials. Without production mode, the installer uses the PDI fallback fields on `u_forward_tenant_binding`.

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

## 3. Event And Script Action

Create event:

- Name: `x_fwd_demo.analyze_ticket`
- Description: `Forward demo: analyze connectivity ticket`

Create Script Action:

- Name: `AnalyzeTicket`
- Event name: `x_fwd_demo.analyze_ticket`
- Script: `AnalyzeTicket_ScriptAction.js`

## 4. Service Portal Widget

Create or update a Service Portal widget:

- Name: `Forward Workflow Demo`
- Template: `sp_widget_template.html`
- CSS: `sp_widget_style.css`
- Client script: `sp_widget_client.js`
- Server script: `sp_widget_server.js`

Create a Service Portal page:

- ID: `connectivity_ticket`
- Title: `Forward Workflow Demo`

Place the widget on the page. The usual URL is:

`https://<instance>.service-now.com/sp?id=connectivity_ticket`

## 5. Tenant Binding

Create one row in `u_forward_tenant_binding` for each ServiceNow user that will run the widget.

For a PDI, the first row is usually:

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

Run `scripts/configure_forward_integrations.py` from the package root to enable Forward ticketing and Forward CMDB sync.

The script installs or updates the org-scoped Forward NQE query `/ServiceNow/Forward Workflow Demo CMDB Netgear CI`, derived from the stock Forward CMDB Netgear CI query with `Device Type` converted to a string for stock PDI compatibility.

Open the demo at:

`https://<instance>.service-now.com/sp?id=connectivity_ticket`

## 7. Change Request Validation

The portal can validate a selected path against a native `change_request`. It creates a `u_forward_change_validation` task, links it to the Change Request when a number is supplied, writes Forward evidence to the Change Request work notes, and records pass/fail based on the expected outcome.
