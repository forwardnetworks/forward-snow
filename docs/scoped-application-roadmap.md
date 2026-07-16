# Forward Change Assurance Scoped Application

Status: active migration plan

## Distribution Target

Build `forward-snow` as a source-controlled ServiceNow scoped application. Use the ServiceNow SDK and Fluent metadata
as the source of truth, install development builds only on non-production instances, promote Forward-owned builds
through the Application Repository, and use a certified ServiceNow Store application for external customer installs.

Do not choose the permanent scope until Forward's registered ServiceNow vendor prefix is confirmed. The scope is a
published application identity and must not retain the existing `x_fwd_demo` namespace.

Forward does not currently have a registered vendor prefix. Partner onboarding and the exact entry criteria are
tracked in [`servicenow-partner-release-gate.md`](servicenow-partner-release-gate.md). Until that gate is met,
[`servicenow/scoped-app/application-model.json`](../servicenow/scoped-app/application-model.json) is the
scope-neutral executable design contract.

Customers do not need to wait for Forward Store certification. The supported interim lane is a versioned SDK source
kit instantiated once in a customer-owned private scope and promoted through that customer's controls. See
[`customer-managed-scoped-app.md`](customer-managed-scoped-app.md). The later Forward Store application has a
different scope and therefore requires an explicit evidence migration rather than being presented as an in-place
upgrade.

## Application Boundary

The scoped application owns:

- the change-assurance ledger and its ACLs;
- Change Request correlation fields;
- roles for administrators, workflow operators, evidence writers, and read-only auditors;
- Script Includes for bounded worker calls and checksum-validated evidence ingestion;
- the authenticated Scripted REST evidence resource;
- native Workflow Studio actions, subflows, flows, and decision routing;
- Connection and Credential Alias definitions without customer credentials;
- system properties for bounded non-secret policy;
- Automated Test Framework coverage, install/upgrade checks, and instance scan configuration;
- application menus, modules, documentation, and uninstall/retention guidance.

The scoped application never owns Forward or Dynatrace credentials. Each customer binds packaged aliases to native
connections and credentials after installation. The Forward-side runtime retains Forward credentials and publishes
only bounded, checksummed evidence. Dynatrace retains dependency and health evidence.

## Migration From The Field Package

The current installer creates global `u_*` tables and `x_fwd_demo.*` properties. Treat those records as migration
input, not the target application model. The executable inventory and disposition for every installer-owned table,
property, and role is [`servicenow/scoped-app/migration-map.json`](../servicenow/scoped-app/migration-map.json).

The Change Assurance application includes the assurance ledger, path-validation evidence, Change Request
correlation, evidence API, and native flow. The older connectivity portal, hop visualization, CMDB export, routing
groups, and per-user Forward credential binding are not silently absorbed into this application. They remain a
separate legacy package unless product scope explicitly adds them later.

1. Inventory global tables, fields, properties, Script Includes, roles, REST resources, widgets, and data retention.
2. Define stable scoped table and field names after the permanent scope is confirmed.
3. Add an explicit, idempotent migration that copies retained ledger and correlation data without copying secrets.
4. Leave legacy records read-only during a bounded validation period.
5. Require an administrator-approved retirement step; never delete audit evidence automatically.
6. Reject mixed ownership where both the global installer and scoped application can write the same workflow state.

## Native Workflow

Package reusable Workflow Studio actions and subflows in ServiceNow Fluent:

1. Start change assurance from an approved Change Request and store the deterministic run ID.
2. Poll with a bounded interval and timeout until the Forward baseline is captured or the run blocks.
3. Accept fresh deployment and Dynatrace context through a typed subflow contract.
4. Complete change assurance and poll until a terminal decision is available.
5. Route pass, warn, fail, timeout, and worker error without auto-approving, auto-remediating, or changing Forward
   intent.
6. Copy the published ledger decision to the Change Request and retain the checksum-bound attachment and work note.

The actual network change remains outside ServiceNow. The local demo invokes `forward-change-demo` for topology and
device configuration stages; customer deployments invoke their existing change executor.

## Credential And Connection Model

Package Connection and Credential Alias identities, not credential records or sys_ids. Customers bind aliases after
install for:

- the Forward-side assurance worker;
- Forward API access when the optional ServiceNow-native Forward lookup lane is enabled;
- any customer-approved deployment or Dynatrace connection used by their workflow.

Installation, upgrade, diagnostics, export, and logs must never enumerate or emit credential values. Readiness checks
validate alias binding, exact HTTPS origins, role assignment, and bounded timeouts without authenticating unless the
administrator explicitly runs a connection test.

## Release Gates

Every application build must prove:

- deterministic SDK build from a clean checkout;
- no global `u_*` tables or `x_fwd_demo.*` identifiers in the scoped artifact;
- least-privilege ACL and cross-scope access tests;
- checksum and idempotency contract tests;
- Workflow Studio happy-path, blocked, fail, timeout, retry, and recovery tests;
- install, upgrade, rollback, retained-data, and alias-rebinding tests;
- ATF and Instance Scan success on each supported ServiceNow release;
- no credentials, customer URLs, tenant data, or local paths in source or artifacts;
- one matching ServiceNow ledger, Forward snapshot pair, and Dynatrace query-back acceptance run.

## Promotion Model

1. Develop and test with the ServiceNow SDK on a non-production vendor instance.
2. Review and merge the exact source commit; build the scoped application reproducibly.
3. Publish the same version to Forward's Application Repository for internal instance promotion.
4. Run the certification suite and submit the private-scope application through the ServiceNow Build partner and
   Store certification process.
5. Customers install the certified version through Application Manager and bind their own connections and
   credentials.

Do not mix Update Set and Application Repository lifecycle management for the scoped application.
