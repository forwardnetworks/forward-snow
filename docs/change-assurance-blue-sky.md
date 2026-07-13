# Forward ServiceNow Change Assurance: Blue-Sky Workflow

## Product Direction

Evolve this field integration from one-off path validation into a ServiceNow-native change-assurance workflow. A
ServiceNow Change Request starts and owns the workflow, the Forward-side conductor gathers and hashes network evidence,
Dynatrace supplies deployment and service-health evidence, and ServiceNow retains the bounded decision and audit trail.

The customer deployment system remains responsible for deployment and rollback. Forward remains authoritative for
modeled network behavior and persistent network intent. Dynatrace remains authoritative for application health and
problems. ServiceNow remains authoritative for change approval, executable state, ownership, and the planned window.

## Target Customer Experience

1. An approved ServiceNow change enters its implementation window.
2. A ServiceNow Flow starts assurance with the change number, deployment ID, affected services, and Forward network.
3. The Forward-side conductor re-reads the exact change, captures the approved before snapshot and affected dependency
   baseline, then returns a resumable run ID.
4. The customer deployment system performs the application change.
5. ServiceNow resumes the run. The conductor waits for a different processed Forward snapshot and a bounded Dynatrace
   stabilization period.
6. The conductor gathers post-change modeled paths, dry-run intent reconciliation, deployment state, service health,
   and affected-service problems.
7. A deterministic gate returns `pass`, `warn`, or `fail` with reason codes, source IDs, and SHA-256 lineage.
8. ServiceNow upserts one assurance ledger record, attaches the bounded evidence bundle, and adds one idempotent work
   note to the originating Change Request.
9. Dynatrace receives the same aggregate gate event for its assurance timeline. The deployment system consumes the gate
   result and decides whether to promote or roll back.

## System Boundaries

| System | Owns | This integration may do |
| --- | --- | --- |
| ServiceNow | Change approval, state, window, risk, assignment, audit record | Trigger, display, attach bounded evidence, add work notes |
| Forward | Processed snapshots, path analysis, intent inventory | Read evidence and reconcile in dry-run mode |
| Dynatrace | Deployment state, service health, problems, observed dependencies | Read evidence and publish aggregate assurance events |
| Deployment system | Deployment, promotion, rollback | Enforce the returned gate artifact |

The workflow must never infer ServiceNow approval from a copied payload, silently substitute snapshots, write Forward
checks, deploy applications, or copy detailed Forward topology into ServiceNow or Dynatrace.

## Existing Building Blocks

This repository already provides:

- tenant-bound, allowlisted ServiceNow-to-Forward API access;
- Service Portal path analysis and ticket routing;
- Forward ticketing and CMDB integration installation;
- a single-path `u_forward_change_validation` record and Change Request work-note flow;
- production credential posture and admin readiness audit.

The companion Forward/Dynatrace repository already provides:

- authoritative ServiceNow approval/state/window preflight;
- resumable before/after Forward evidence capture;
- bounded Dynatrace stabilization and context freshness checks;
- dry-run Forward reconciliation and deterministic `pass`/`warn`/`fail` gating;
- checksummed evidence, ServiceNow feedback, and Dynatrace publication contracts.

## New ServiceNow Assurance Ledger

Add `u_forward_change_assurance`, extending `task`, with one row per unique evidence bundle. It is separate from
`u_forward_change_validation`: the existing table represents one expected path outcome, while the assurance ledger
represents an entire deployment run across ServiceNow, Dynatrace, and Forward.

Minimum record contract:

- Change Request, run ID, deployment ID, affected service IDs;
- lifecycle state and final decision;
- reason codes;
- Forward network and before/after snapshot IDs;
- reconciliation run and state;
- Dynatrace deployment state, service health, and open-problem count;
- preflight, gate, and evidence SHA-256 values;
- unique idempotency key, attachment reference, and work-note marker;
- generated time and publication status.

The full bounded JSON evidence is stored as an attachment. The table does not store path rows, hops, devices,
credentials, authorization headers, or raw Forward responses.

## Integration Contracts

### Start request

ServiceNow sends:

```json
{
  "changeNumber": "CHG0042187",
  "deploymentId": "checkout-api-2026.07.15.3",
  "affectedRecords": [
    {
      "table": "cmdb_ci_service",
      "sysId": "0123456789abcdef0123456789abcdef"
    }
  ]
}
```

The worker resolves the Dynatrace service entities, Forward network, and reviewed endpoint bindings from its protected
environment mapping. The Flow never asks an operator to type cross-system IDs or topology.

The conductor returns a run ID and baseline-captured state. ServiceNow stores the run ID but does not treat baseline
capture as approval or a final gate.

### Completion evidence

The authoritative callback is
`forward-dynatrace-servicenow-change-assurance-evidence/v1`. The ServiceNow contract validator requires exact change,
deployment, network, snapshot, decision, Dynatrace state, reason-code, and SHA-256 fields; recomputes the embedded
preflight and gate hashes; and rejects topology- or credential-shaped content. The companion conductor now submits the
exact evidence bytes through the authenticated ingress and fails closed on a mismatched publication receipt.
The required `X-Forward-Dynatrace-SHA256` header is checked against the raw body before any ledger write.

### Idempotency

The evidence SHA-256 produces `forward-dynatrace:<sha256>`. The ledger field is unique. Replays return the existing
record; they do not add another attachment or work note. The attachment is created before the work note so the note
cannot reference missing evidence.

## Phased Implementation

Current repository status:

- Phase 1 ledger, contract validation, idempotent attachment/work-note service, installer wiring, and local tests are
  implemented.
- Phase 2 authenticated evidence-ingress resource, companion completion callback, purchase-free start/status/complete
  worker API, and ServiceNow Script Include are implemented. The three core Script-step actions must be created and
  published in the target instance because Flow metadata is customer-owned.

### Phase 1: Native assurance ledger and contract

- Add the table, fields, choices, property, Script Includes, audit checks, and local contract tests.
- Normalize and validate the bounded Forward/Dynatrace evidence contract.
- Upsert by evidence idempotency key and write attachment before work note.

### Phase 2: ServiceNow ingress and Flow Designer actions

- Add an authenticated Scripted REST resource for final evidence ingestion. **Implemented in repo.**
- Add start, status, and complete Flow Designer actions targeting the Forward-side conductor. **Script Include,
  worker API, and copy-ready core Script steps are implemented.**
- Separate read-only start credentials from bounded feedback credentials.
- Add retry/backoff and explicit timeout states.

## Forward CMDB `choice` Boundary

The assurance ledger's `u_lifecycle_state`, `u_decision`, and `u_publication_status` fields are ServiceNow-native
`choice` fields written by `ChangeAssuranceService`. They are not Forward CMDB mapping targets. Forward's current CMDB
mapper accepts scalar NQE output for `string`, `integer`, `float`, `boolean`, and `ip_addr` fields, with `reference`
handled separately; it does not directly map a ServiceNow `choice` field. If a customer needs a CMDB choice value,
use a ServiceNow business rule, flow, transform, default, or temporary string field as an explicit workaround rather
than presenting NQE as direct `choice` support.

### Phase 3: Change workspace and assurance timeline

- Add a related list and workspace view on `change_request`.
- Show phase, decision, reason codes, snapshots, Dynatrace health, hashes, and publication receipts.
- Add overlapping-change detection for shared services, dependencies, or network scope.

### Phase 4: Policy packs and scope discovery

- Propose affected services and dependencies from the Change Request CI/application and Dynatrace relationships.
- Require operator confirmation before baseline capture.
- Apply versioned, checksummed policy packs by service tier and change risk.
- Keep `warn`/`fail` enforcement deterministic and customer-owned.

### Phase 5: Learning and operations

- Measure gate accuracy, false warnings, missed incidents, stabilization duration, and mapping gaps.
- Add retention, recovery, compatibility, and upgrade tests.
- Graduate to an owned connector/service only after support, credential, and operational ownership are accepted.

## Acceptance Gates

Repository automation must prove contract rejection, normalization, idempotency, installer coverage, and audit coverage.
Live acceptance additionally requires one approved and one blocked non-production change, a safe and regression
before/after pair, evidence readback, a duplicate-free retry, and matching Dynatrace query-back.
