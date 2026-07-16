# ServiceNow Partner And Store Release Gate

Status: external prerequisite for customer distribution

## Decision

Forward Change Assurance will be distributed to customers as a certified ServiceNow Store application. Forward does
not currently have a registered ServiceNow vendor prefix, so the repository must not create or publish a permanent
application scope yet.

The application design, contracts, tests, and migration tooling remain source controlled and scope neutral until the
registered prefix and Build Partner vendor instance are available. The existing `x_fwd_demo` namespace is never a
candidate production identity.

## Forward Business Owner Actions

1. Apply to the ServiceNow Build Partner Program at
   <https://www.servicenow.com/partners/become-a-partner.html>.
2. Confirm the legal publisher name, product owner, security contact, support contact, and Store commercial model.
3. Obtain access to the Partner Portal, Store Publisher Portal, and a Build Partner vendor instance.
4. Record the registered vendor prefix in the approved internal product record; the repository needs only the
   non-secret prefix, never Partner Portal credentials.
5. Confirm supported ServiceNow releases and the certification submission entitlement with the partner contact.

Commercial terms, program acceptance, publisher agreements, and certification entitlements are ServiceNow/Forward
business decisions. Do not infer them from a personal developer instance or commit them to this repository.

## Engineering Entry Criteria

SDK project creation may begin only when all of these are true:

- the registered vendor prefix is known;
- a company-controlled vendor development instance exists;
- the intended scope is unique, begins with `x_<registered-prefix>`, and is 18 characters or fewer;
- the scope does not contain `demo`, `lab`, `test`, a person's name, or a customer name;
- application ownership, signing/publishing access, and recovery ownership are assigned;
- the Store app name and support lifecycle are approved.

The exact permanent scope is then written once into the application definition and ServiceNow SDK project. Changing
it later requires an explicit migration decision; automation must never silently rewrite it.

## Environments And Promotion

| Environment | Purpose | Permitted distribution |
| --- | --- | --- |
| Personal sandbox | Contract and disposable integration testing | No release publication |
| Build Partner vendor development | Authoritative scoped-app development and SDK install | Development builds only |
| Forward vendor test | ATF, upgrade, rollback, Instance Scan, and certification rehearsal | Application Repository |
| Forward vendor production/publisher | Versioned release authority | Application Repository and Store submission |
| Customer sub-production/production | Customer acceptance and use | Certified Store version |

Do not mix Update Sets with Application Repository or Store lifecycle management for this app.

## Certification Readiness Evidence

Before the first Store submission, retain a release bundle containing:

- the source commit, SDK and Node versions, dependency lockfile, and reproducible build output;
- ATF and Instance Scan reports for every claimed ServiceNow release;
- install, upgrade, rollback, uninstall, retained-data, and alias-rebinding results;
- ACL, cross-scope, scripted REST, payload-bound, checksum, and idempotency tests;
- Software Bill of Materials and third-party license review;
- security architecture, data-flow, credential, logging, retention, and support documentation;
- one accepted end-to-end Change Request run with ServiceNow ledger/work note/attachment, Forward snapshots and
  reconciliation, and Dynatrace query-back evidence;
- customer installation, upgrade, configuration, troubleshooting, and data-removal runbooks.

Partner onboarding can proceed in parallel with repository work, but Store publication cannot proceed until this
gate is satisfied.
