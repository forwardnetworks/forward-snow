# Forward validation criteria and runs on the Change Request

Phase 4 of `2026-10-30-native-forward-features.md`. It restates "change-control parity" for ServiceNow.

## Decision: stay native, add only what Forward provides

forward-netbox builds its own approval engine (policies, reviewer rules, comments, a state machine) because NetBox has no
change approvals. ServiceNow does: Change Approval Policies, approval groups, CAB, Flow Designer and task comments.
Rebuilding them would fight the platform and drift from the customer's own process. So this phase does not clone them.
It adds the part only Forward can supply: acceptance criteria answered by Forward, a scored validation run, and fields the
native approval policies and flows can read.

## Goal

An operator lists criteria for a change (a saved Forward NQE query and what to expect of its rows), pins them to a
committed query version, and runs them against a Forward snapshot. The run records a pass, fail or error per criterion and a
score. The Change Request carries the latest status and score so a native Change Approval Policy, flow or report can use
them. Nothing in this phase is read by the existing assurance gate or close guard.

## Constraints

- Read-only against Forward: resolve a query path, run a pinned query. No write.
- Binding is required. A criterion that is not pinned to a query id and commit id is never run, because the query could
  change underneath the change it judges. Editing a bound criterion's path clears the binding.
- Result rows are never stored, logged or returned: only counts and a verdict. Device or row content never reaches a
  result, a log or an error.
- A criterion Forward could not answer is `error`, one not measured is `skipped`. Neither is a pass. A run that measured
  nothing has no score.
- `no_rows` and `some_rows` judge the run snapshot. `no_diff` also needs a baseline snapshot and compares the set of rows
  in memory; if either side is cut off (more rows than the limit) the result is `error`, not a guess.
- Scoring follows forward-netbox: 100 minus a penalty per failing or erroring result (info 0, warning 3, error 10,
  critical 25), floor 0.
- Snapshot choice: an explicit snapshot id input, else the newest processed snapshot (Forward's rule). The baseline for
  `no_diff` is an explicit input or the change's assurance record `before_snapshot_id`; without one a `no_diff` criterion
  is skipped.
- Roles: operators create and bind criteria and run validation; auditors read. Writes to runs and results are by script
  only (the same script-false ACL pattern as Predict runs).
- Fixtures are synthetic. No customer identifiers.

## Out (and why)

- Forward intent checks as a second engine and the Predict engine: separate routes and a per-check model; a later phase.
- Reviewer rules, approvals, comments and a state machine: ServiceNow already has them.
- Gating the close or an approval on the score from this app: left to native Change Approval Policies. Wiring it into the
  assurance close guard would change the evidence contract and hashes, so it is a separate decision.

## Forward calls (read only)

| Step | Call |
| --- | --- |
| head commit | `GET /nqe/repos/org/commits/head` → a JSON string |
| resolve | `GET /nqe/repos/org/commits/{commit}/queries?path=<path>` → object with `queryId`; a missing path is a 404 |
| run | `POST /nqe?snapshotId=<id>` body `{queryId, commitId, queryOptions: {limit}}` → `{items, totalNumItems}`; a query error is a 4xx |

## Data

- `x_..._criterion`: change, name, query_path, expectation (`no_rows`, `some_rows`, `no_diff`), severity, active, query_id,
  commit_id (set by Bind only; users cannot write them).
- `x_..._validation_run`: change, status (`running`, `complete`, `error`), score (integer, empty when nothing measured),
  snapshot_id, baseline_snapshot_id, passed, failed, errored, skipped, started_at.
- `x_..._validation_result`: run, criterion, status (`pass`, `fail`, `error`, `skipped`), row_count, detail (fixed phrase).
- Change fields `validation_status` and `validation_score`, written by script only.

## Flow

1. `bind(changeSysId)`: for each active criterion, resolve the path at the head commit and store `query_id`, `commit_id`.
   A failure leaves it unbound with a fixed reason.
2. `run(changeSysId, snapshotId, baselineSnapshotId)`: refuse System; need write access to the change; refuse if no
   active criteria, any is unbound, or a run is already `running` (unique claim like Predict). For each criterion, run the
   pinned query (limit 1001), judge, write a result. Compute score, write the run and the change fields.

## Packaging

`ForwardApiClient` gains `headCommit`, `resolveQuery`, `runQuery`. New script include `ForwardValidation`. Actions
`Bind Forward Criteria` and `Run Forward Validation`. Tables, ACLs, change fields, model and docs.

## Validation

- Node tests with fakes, derived from the requirements above: refusals, binding required, expectation maths including
  truncation, score table, no row content anywhere, claim, no-diff set comparison.
- Consistency test (model vs Fluent) and generator build still pass.
- Live: bind and run a real saved query against a synthetic demo network on the PDI (reads only).
- Not verified until then: how Forward words a query error, and large result handling.

## Rollback

Additive tables and a script include. Nothing else reads them; uninstalling removes them.

## Review decisions (2026-10-31)

A plan review approved the native-first decision and required these changes, all now in the design and code:

- **Staleness.** A criteria revision counter on the Change Request is bumped by a rule on every criterion insert, update and
  delete, copied onto each run, and an earlier verdict becomes `stale` when the counter moves, including during a run.
- **Trustworthy change fields.** The status, score, snapshot and revision fields on the Change Request, and the Predict
  revision, are locked by field ACLs that no user can pass, so a native approval policy can rely on them.
- **Binding cannot be forged or moved.** Pinned query and commit ids and the binding note cannot be created or written by a
  user; a rule clears a binding present on insert or after a path edit, and keeps a criterion on its change. Bind leaves
  pinned criteria alone unless `rebind` is true, because re-pinning moves the version. Bind refuses System, a user who
  cannot write the change, a closed change and a running validation.
- **Network.** `forward.network_id` is the network. A snapshot or baseline is used only if it is one of that network's
  processed snapshots, and the assurance record's baseline only when it names the same network.
- **Limits.** `forward.validation_max_criteria` caps a run; a stuck claim expires from the timeout; every result keeps the
  query and commit that were run.
- **Status values.** `pass` needs every criterion measured and passing. `incomplete` means a criterion was skipped,
  `error` that Forward could not answer, `fail` that one failed, `stale` that criteria changed, `not_run` that nothing was
  measured. The score is blank when nothing was measured; act on the status.
- **Query errors.** A query error that arrives as a 200 with errors in the body is refused without reading it. Row checks ask
  for one row and use Forward's total.
- **Closed changes.** Bind and run refuse a closed or cancelled change.
- Not done: other engines (intent checks, Predict), and wiring a score into the assurance close guard.

## Known limits

- A validation run lists the network's processed snapshots to check that the one used belongs to the network, so a network
  with 500 or more processed, unarchived snapshots cannot run validation (the list is refused rather than trimmed).
- The capability probe treats a 404 from the change-set list as "not offered", which can also mean a wrong network id.
- Query results over the response-size limit (`forward.max_response_bytes`) are an `error` for that criterion, never a pass.
- The Refresh Forward Prediction button has no opt-in condition on purpose, so a run can still be finished after the
  feature is switched off.
- Verified live (2026-10-31): a query that needs a parameter is answered by Forward with a 4xx; the criterion became `error`
  with a fixed phrase and a penalty, and nothing from Forward's message was kept.
- Not verified: the Predict buttons clicked in a browser (their server halves ran on the instance), and licence-refusal wording.
