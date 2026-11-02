# PDI development installation

Use this procedure only for a clean Personal Developer Instance or other non-production development instance. It
creates a development-scoped application and must not be used to publish through Application Repository or the
ServiceNow Store.

## Prerequisites

- The instance is on Washington DC or newer and has **ServiceNow IDE Platform** installed and active.
- You have an administrator/developer account and an SDK authentication alias.
- The instance-specific vendor prefix is known. A PDI owns its prefix; for example, this repository's development PDI
  uses `x_931473_`, so its application scope is `x_931473_fwd`.

Never use a branding-only scope such as `x_fwd_snow` if the instance reports a different registered prefix. The SDK
validates this when `--auth` is supplied and warns on a mismatch.

## Install

```bash
git clone https://github.com/forwardnetworks/forward-snow.git
cd forward-snow
npm ci
npm run validate

npx @servicenow/sdk auth \
  --add https://<instance>.service-now.com \
  --type oauth \
  --alias dev-pdi

python3 scripts/materialize_servicenow_scoped_app.py \
  --scope x_<instance-prefix>_fwd \
  --auth dev-pdi \
  --output ../forward-change-assurance-pdi \
  --install-dependencies

cd ../forward-change-assurance-pdi
npm run build
npm run build:ci
npm run deploy -- --auth dev-pdi
```

The generated deploy command forces `--demoData false --reinstall false`. Do not override either option. `--reinstall`
can delete instance metadata that is absent from the generated package.

## Verify

In **Application Manager**, confirm the application is active. The following must exist under the selected scope:

- `Forward Change Assurance` application, version `0.1.0`;
- assurance and path-validation tables;
- `admin`, `operator`, `auditor`, and `evidence_writer` roles;
- `ChangeAssuranceContract`, `ChangeAssuranceService`, `ChangeAssuranceFlowClient`, and
  `ChangeAssuranceCloseGuard` Script Includes;
- the active `Forward Change Assurance` Scripted REST API.

Direct Table API access to the two ledger tables should be denied: this is the expected least-privilege posture.
Complete ATF, Instance Scan, ACL/cross-scope negative tests, and the checksum-bound evidence-ingest acceptance test
before treating any installation as an approved test build.

## Scope and credential safety

Commit the generated `now.config.json`, lockfile, and Fluent generated keys only to the private repository that owns
that scope. Do not commit an SDK alias, password, OAuth secret, PDI-specific scope ID, or customer connection data to
this source kit. Rotate any password that was displayed in a terminal, browser history, or chat.
