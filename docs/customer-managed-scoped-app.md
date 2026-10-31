# Customer-Managed Scoped Application

Status: production deployment path

## Purpose

Before Forward has a certified Store application, a customer can deploy Forward Change Assurance as a
customer-owned private scoped application. Forward supplies a versioned ServiceNow SDK source kit and supportable
release evidence. The customer creates and owns the application identity, installs it in a company-controlled
non-production instance, binds credentials locally, runs acceptance tests, and promotes the approved version through
its own deployment controls.

This is a productized implementation kit, not a global installer, shared Update Set, browser automation, or Forward
Application Repository entitlement.

## Ownership Boundary

Forward owns:

- the versioned source template, contract schemas, build instructions, tests, release notes, and checksums;
- the behavior of the native actions, subflows, ledger, evidence API, and readiness diagnostics;
- compatibility claims for explicitly tested ServiceNow releases;
- support for an unmodified release kit installed according to this guide.

The customer owns:

- the private application scope and generated scope ID;
- ServiceNow instances, SDK authentication aliases, delegated-development roles, and deployment approvals;
- connection and credential alias bindings and all credential values;
- App Repository publication, entitlements, production installation, retention, and local support ownership;
- any local modifications, which must be tracked as a customer fork.

Forward never receives the customer's ServiceNow SDK credentials, connection credentials, credential sys_ids, or
Partner/Now Support credentials.

## Prerequisites

- a customer-controlled, non-production ServiceNow development instance;
- an administrator or delegated developer with the required application-development permissions;
- an unused customer-approved private scope beginning with the customer's namespace and no more than 18 characters;
- a ServiceNow release supported by the pinned SDK and by the Forward release matrix;
- Node.js and npm versions meeting the pinned ServiceNow SDK requirements;
- access from the customer's build workstation or runner to its ServiceNow development instance;
- customer-approved Git, artifact, change, and credential-management controls.

Run `python3 scripts/validate_customer_scope.py <scope>` before the SDK project is created. A release bootstrap command
will materialize the generic Forward sources into that one customer-owned scope. The generated `now.config.json`,
including its scope ID, becomes part of the customer's controlled application source and must remain stable across
upgrades.

## Customer Deployment Sequence

1. Verify the release checksum, bill of materials, supported ServiceNow release, and Forward release notes.
2. Select and validate the permanent customer-owned scope.
3. Materialize the SDK project once; commit its generated identity and dependency lockfile to the customer's private
   application repository.
4. Configure ServiceNow SDK authentication locally using a customer-controlled alias.
5. Build from a clean checkout and install only in the customer development instance.
6. Bind the packaged assurance-worker connection and credential aliases. Do not modify source or properties with
   credential values.
7. Run ATF, Instance Scan, readiness diagnostics, and negative-security tests.
8. Review the application files, ACLs, cross-scope privileges, external HTTPS origins, and retained-data policy.
9. Publish the approved version to the customer's Application Repository and restrict instance entitlements as
   required.
10. Install the exact approved version in test and production through the customer's normal change process.

For ServiceNow-hosted instances, the customer's Application Repository is the preferred promotion channel because it
is private to that organization. It cannot be used to distribute Forward's copy of the app to unrelated customers.
Application Repository is unavailable for self-hosted instances; those customers must select one ServiceNow-supported
internal deployment lifecycle and validate it with their platform owner. Never mix Application Repository and Update
Set lifecycle management for the same application.

## Upgrades And Customer Modifications

- A customer's scope and scope ID never change during upgrades. Upgrade from the original project directory and keep it,
  with `now.config.json` and `src/fluent/generated/keys.ts`, in the private repository: the keys fix the record IDs
  the instance already holds. Generate a new project only for a first install.
- Recovery only: if the original project and keys are lost, `--scope-id <application sys_id>` regenerates a project
  that the instance accepts for the same application (without it the scope is refused as already taken). Its record
  IDs are new, so deploying it over the installed copy creates a second copy of every script include and can leave
  flows failing to activate. Remove the installed application from its rollback record first, then deploy once.
- Forward release versions are applied to the customer's private source branch and reviewed as ordinary source
  changes before build.
- The upgrade must preserve customer-owned aliases, bindings, retained ledger records, and local policy values.
- Local changes are a customer fork. Forward tests the unmodified release kit; fork reconciliation is an explicit
  professional-services or customer engineering activity.
- Reinstall flags that can remove instance metadata are prohibited from routine deployment.

## Forward Predict (advisory, off by default)

Predict asks Forward what the commands proposed for a Change Request would do, in a dedicated network, and shows the
outcome. Nothing in the assurance gate, close guard or verdict reads it.

- Enable it only after naming a dedicated network in `forward.predict_network_id` (never the production network) and
  setting `forward.predict_enabled` to true. Every start also needs an explicit confirmation.
- The Forward API credential bound to the `Forward API` alias must be allowed to create change sets in that network.
  Use a separate alias and connection if the read-only path-search credential should stay read-only.
- Proposed commands can contain keys and SNMP communities. They live in the `Forward Predict Proposal` table, which has
  no audit, journal or web service access and is readable only by users who can change the Change Request. They are
  deleted when the change closes or is cancelled. ServiceNow's outbound HTTP log can still record request bodies if an
  administrator raises `glide.outbound_http_log.override.level`; leave it at its default while Predict is on.
- Cleanup deletes the Forward change set when a change closes, is cancelled or is deleted, and before a new prediction.
  Run it for every open prediction before uninstalling the application, because the change-set ids are removed with
  the tables. Change sets are tagged `forward-change-assurance` in Forward, so leftovers can also be found there.
- The change-set routes are not part of Forward's published API. The create, validate, stage, commit, predict, refresh
  and cleanup calls have run once from this application against a Forward test account (see the Predict plan); a
  licence refusal, other device types and the close and cancel cleanup have not. Treat your first run as a test.
