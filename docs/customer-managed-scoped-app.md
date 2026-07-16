# Customer-Managed Scoped Application

Status: supported pre-Store distribution path under construction

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
- the behavior of the native actions, subflows, ledger, evidence API, migration utility, and readiness diagnostics;
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
7. Run ATF, Instance Scan, readiness diagnostics, negative-security tests, and the full pre-change/post-change demo.
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

- A customer's scope and scope ID never change during upgrades.
- Forward release versions are applied to the customer's private source branch and reviewed as ordinary source
  changes before build.
- The upgrade must preserve customer-owned aliases, bindings, retained ledger records, and local policy values.
- Local changes are a customer fork. Forward tests the unmodified release kit; fork reconciliation is an explicit
  professional-services or customer engineering activity.
- Reinstall flags that can remove instance metadata are prohibited from routine deployment.

## Transition To The Future Store Application

The Forward Store application will use a different Forward-owned scope and is therefore a separate application, not
an in-place upgrade of customer-owned scopes.

The supported transition is:

1. stop new runs in the customer-owned app and leave its audit records readable;
2. install the certified Store application in non-production;
3. bind new Store-app aliases to the same customer-owned connections and credentials;
4. run an idempotent, checksum-verified migration of allowed ledger, attachment, and Change Request correlation data;
5. prove record counts, hashes, ACLs, flow behavior, and a new end-to-end acceptance run;
6. promote the Store application and retire the customer-owned writer paths with administrator approval;
7. retain or remove the legacy app and data according to customer policy—never automatically.

No credential value, authentication record, connection sys_id, or customer URL is exported as migration data.
