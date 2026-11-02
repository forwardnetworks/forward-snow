# Forward Change Assurance application

## Production distribution

The repository has one supported artifact: a ServiceNow scoped application generated from the SDK/Fluent template.
Each customer owns its scope, credentials, application repository, approvals, and promotion lifecycle. The source kit
does not contain global records, Update Sets, demo identities, compatibility installers, or fallback credential paths.

The permanent scope must be confirmed before generation. It begins with `x_`, is at most 18 characters, and contains a
customer namespace plus application identifier. The generator rejects disposable or non-production names.

## Application boundary

The application owns the assurance ledger, path-validation records, Change Request correlation, strict evidence API,
native Workflow Studio actions, ACLs, roles, connection aliases, non-secret policy properties, install tests, and
Instance Scan/ATF coverage. It never packages credentials or owns deployment execution, approval, remediation, or
observability credentials.

## Build and promotion gates

Every release must prove a clean deterministic SDK build, zero compiler or metadata errors, strict checksum and
idempotency behavior, least-privilege ACLs, negative-security tests, ATF and Instance Scan success, and a successful
non-production end-to-end acceptance run. Promote the exact tested artifact through the customer Application
Repository. Never mix SDK lifecycle management with Update Sets.

ServiceNow-hosted customers should publish to **My Company Applications** and install entitled versions there. The
Application Repository is not available to self-hosted customers; those customers must use their supported internal
scoped-application deployment lifecycle.
