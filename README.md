# Forward Change Assurance ServiceNow application

This repository contains one deployment artifact: a customer-owned ServiceNow scoped application built with the
ServiceNow SDK and Fluent source. It provides bounded Forward change-assurance actions, evidence ingestion,
idempotent audit storage, ACLs, and strict connection/credential policy.

There is no global installer, Update Set installer, demo namespace, portal installer, or separate Forward integration
installer in this repository.

## Requirements

- Node.js 20.18.0 or newer
- npm 8.19.3 or newer
- A ServiceNow development instance beginning with Washington DC
- ServiceNow IDE 4.1.1 or newer installed on that instance
- A customer-owned scoped application name beginning with `x_`, no more than 18 characters, and containing no
  `demo`, `test`, `lab`, `sandbox`, or `personal` term

The SDK is installed locally in the generated application. Do not install it globally.
ServiceNow IDE is the instance-side component that receives SDK application packages; install and activate it from
the ServiceNow Store before the first SDK deployment.

## Create and install the application

Validate a permanent scope and materialize a new SDK project:

```bash
python3 scripts/validate_customer_scope.py x_acme_fca
python3 scripts/materialize_servicenow_scoped_app.py \
  --scope x_acme_fca \
  --output ../forward-change-assurance-app \
  --install-dependencies
cd ../forward-change-assurance-app
```

For a PDI or other instance that enforces its registered vendor prefix, authenticate first and pass the SDK alias to
the generator. The scope must begin with that instance's prefix; do not substitute a branding-only prefix.

Authenticate locally with an OAuth alias. Credentials stay in the local SDK configuration and are never written to
this source kit:

```bash
npx @servicenow/sdk auth --add https://instance.service-now.com --type oauth --alias pdi
npm run build
npm run deploy -- --auth pdi
```

The SDK build is wrapped by `scripts/verified-build.mjs`, which fails closed on compiler and metadata errors. The
generated deploy command explicitly disables SDK demo data and reinstall behavior. Install only the exact build that
passed validation. Use the customer’s normal source-control and promotion process for test and production instances;
do not mix SDK installation with Update Sets.

For a company-wide distribution, publish the tested scoped application to the ServiceNow Application Repository and
install it from **System Applications > My Company Applications**. Application Repository is the supported promotion
path for ServiceNow-hosted customer instances. This repository has not published an Application Repository or Store
release: that remains blocked until Forward has a registered vendor prefix and an approved release record.

## Repository layout

- `servicenow/scoped-app-template/` — SDK/Fluent source template
- `servicenow/scoped-app/` — application contract and release metadata
- `scripts/materialize_servicenow_scoped_app.py` — project generator
- `scripts/validate_customer_scope.py` — scope safety checks
- `docs/customer-managed-scoped-app.md` — deployment, upgrade, and promotion runbook
- `docs/pdi-install.md` — clean PDI/development installation and verification guide
- `docs/scoped-application-roadmap.md` — Store and vendor-scope roadmap

## Validation

```bash
npm ci
npm run validate
```

The validation suite is credential-free and performs no ServiceNow API calls.
