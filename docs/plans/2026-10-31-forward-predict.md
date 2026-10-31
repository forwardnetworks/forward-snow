# Forward Predict on the Change Request (advisory)

Phase 3 of `2026-10-30-native-forward-features.md`. This is the first feature that writes to Forward.

## Goal

An operator records the CLI commands a change will apply, per device. On explicit confirmation the instance asks Forward
to predict the change and shows the outcome (the predicted snapshot and its state) on the change. The prediction is
advisory. No gate, close guard, rule or verdict reads it.

## Constraints

- Opt-in: `forward.predict_enabled` (boolean, default `false`) is enforced in server code, not only in a UI condition.
- Every start needs an explicit `confirm` input equal to `true`; anything else refuses before any Forward call.
- Forward holds the change set. It is created in `forward.predict_network_id`, a network the operator names for this
  purpose (as forward-netbox uses a workspace network), never implicitly in the production network from
  `forward.network_id`. A blank value refuses the start. The base is that network's newest processed snapshot by
  Forward's own rule, which must be `PROCESSED`.
- The change-set routes are unpublished (forward-python-sdk `spec/unpublished.yaml`). Shapes are taken from there and are
  less stable than the published API.
- Commands can hold keys and SNMP communities. They live only in the proposal table (auditing off, not a journal field,
  not a work note, not an event, not in a log line, not in the evidence bundle, not in an error message or flow output).
- Credentials stay in the `Forward API` alias. No stored passwords.
- Predict needs a licensed Forward org. Availability is found by asking and reading the refusal (`forbidden`), not by a
  pre-check.
- Out: BGP advertisements, PAN-OS devices, validating the predicted snapshot, any gate that reads the result.
- Fixtures are synthetic.

## Forward calls (all unpublished)

Order is create, validate, stage, commit, predict. Validate takes the commands in its own body and stores nothing, so a
refusal leaves no command text in a Forward draft.

| Step | Call |
| --- | --- |
| create | `POST /networks/{n}/change-sets` body `{name, snapshotId, description, tags}` → `{id}`. The name is deterministic (`<change number>-<run id>`) and tagged so orphans can be found. |
| validate | `POST /networks/{n}/change-sets/{cs}/devices/{device}/commands?action=validate` body `{commands, cursorLineNum, cursorColumnNum}`. Any `commandErrors` entry refuses. Only line and column are ever kept, never the text. |
| stage | `PUT /networks/{n}/change-sets/{cs}/draft/devices/{device}/commands`, text body. |
| commit | `POST /networks/{n}/change-sets/{cs}/commits?note=<fixed note>`. The note is required and non-blank: `<change number> <run id>`. |
| predict | `POST /networks/{n}/change-sets/{cs}?action=predict&note=<same>` → `{id}`. |
| refresh | `GET /networks/{n}/change-sets/{cs}/predicted-snapshots` → matching snapshot `state`. There is no single-snapshot route, and `listSnapshots` filters to PROCESSED, so it cannot be used. |
| cleanup | `DELETE /networks/{n}/change-sets/{cs}`. Only 2xx or 404 count as cleaned. |

Snapshot states: `PROCESSED` is answered; `FAILED`, `CANCELED`, `TIMED_OUT`, `RESTORE_FAILED` are failed (Forward's own
`TIMED_OUT` state, not an HTTP timeout); an HTTP timeout is never an answer; anything else, or a snapshot not listed yet,
stays pending until the claim expires.

Commit and predict are never retried. Device names get their own validator (dots allowed, length capped) and are URL
encoded. Command size per device and the number of devices are capped. Outbound writes set the REST log level to
`basic`; the admin override `glide.outbound_http_log.override.level` can still log bodies and is documented as a
remaining exposure.

## Data

- `x_..._predict_proposal`: change, device_name, commands. Not extending `task`. Auditing off, field `no_audit`, web
  service access off, package private. Rows are secrets: the read ACL requires write access to the change, and proposals
  are purged when the change closes or is cancelled.
- `x_..._predict_run`, written only by script (no create or write ACL for any role): change, claim, outcome
  (`starting`, `pending`, `answered`, `failed`), cleanup status (`open`, `cleaned`), change_set_id, predicted_snapshot_id,
  network_id, started_at, proposal revision, detail (a fixed phrase naming an error kind).
- `claim` is unique-indexed. It holds the change sys_id while the run is active and the run's own sys_id when it ends, so
  a second start's insert fails and is refused. This replaces check-then-insert.
- The change carries a proposal revision counter, bumped by business rules on proposal insert, update and delete. A run
  copies it at start, taken before the proposals are read. A run is stale when the counter differs. Nothing derived
  from command text is stored.

## Flow

1. `start(changeSysId, confirm)`: refuse System, `String(confirm) !== "true"`, a disabled feature, a missing network,
   missing write access to the change, no proposals, or an active run (the unique claim). Then create, validate every
   device, stage every device, commit, predict. The change-set id is saved the moment create returns and the predicted
   snapshot id the moment predict returns. Before each write the start re-reads the run and checks outcome and claim; on
   losing the claim it deletes the change set it made. Any failure marks the run `failed`, deletes the change set best
   effort, and rethrows one fixed generic error (never the underlying message). Claim expiry is longer than the longest
   start (device cap times the per-call timeout, under the transaction limit).
2. `refresh(changeSysId)`: expired `starting` runs and `pending` runs whose snapshot is not listed past expiry become
   `failed`. It re-checks the stored state before every write and never reopens a cleaned run.
3. `cleanup`: deletes every change set of a run that is not `cleaned`, including failed runs. It runs from an
   after-commit business rule on close and cancel, from a re-predict, and from a delete of the change (capturing the ids
   first), with a privileged code path that does not refuse System. It is not gated on `predict_enabled`, and it marks a
   run `cleaned` only after a 2xx or 404. It never blocks a transition.

## Packaging

`ForwardApiClient` gains POST, PUT and DELETE with the same bounds. `ForwardPredict` holds the lifecycle. Actions:
`Start Forward Prediction` and `Refresh Forward Prediction`. Properties: `forward.predict_enabled`,
`forward.predict_network_id`, `forward.predict_max_devices`. The shared `Forward API` alias now needs change-set write
permission in the predict network; document that, or bind a separate alias. Contract surfaces to update: the
"read-only Forward API calls" wording in `application-model.json`, the materializer, `server.now.ts`, `tests.now.ts`.

Dropped on purpose, with a reason: BGP advertisements and a proposal `kind` column (out of scope), PAN-OS refusal (the
device OS is unknown here, so it fails at predict), the four NetBox 403 messages (the client discards bodies; revisit
with a whitelisted denial kind), editing only while unapproved (ServiceNow change approval differs; revisit in phase 4),
and polling by subflow (manual refresh first).

## Validation

- `npm run validate` with the new tests; the generated app builds with `build` and `build:ci`.
- A test proves nothing reads the predict tables from the close guard, service or ingest assets.
- A behavioural test proves a command string never reaches `gs` logging, thrown errors, run `detail`, action outputs or the REST log level setting.
- Tests for the unique claim, the lost-claim cleanup, expiry, the stale counter (including a delete), the refresh state map, and cleanup on every path.
- **Live result:** see Live check below. What it did not cover is the remaining unverified list.
- **Originally unverified (now partly answered):** every Forward call above on a Predict-licensed org, whether a change set can be
  created in the chosen network on its newest snapshot, and how long processing takes. The live run needs a
  non-customer licensed org and the operator's go because it writes.

## Rollback

Switch `forward.predict_enabled` off; cleanup still runs. Before uninstalling, run cleanup for every open run, because the ids go with the tables. Change sets can also be found in Forward by their run tag and deleted there.

## Live check (2026-10-31, Brazil PDI to a synthetic Forward demo network)

Run through the shipped `ForwardPredict`, `ForwardApiClient` and actions' code on the PDI, with the `Forward API` alias
bound to a Forward test account. A temporary one-device workspace (1-day retention) was forked from a synthetic change-control
demo network, used, and deleted afterwards. Forward held no change sets when it finished.

- Verified: workspace creation; the workspace baseline is processed within about 30 seconds; `change-sets` create returns
  an id like `CHG-<n>` and accepts a tag; `validate` returns `commandErrors` (with `lineNumber`) and the refusal path
  ended the run, deleted the change set and released the claim; stage, commit (with a non-blank note) and predict
  returned a predicted snapshot id; `predicted-snapshots` reported it `PROCESSED` within about a minute and the run read
  `answered`; `cleanup` deleted the change set (204) and the run read `cleaned` with the claim released; the before-delete
  rule ran on deleting the change without blocking it; the closed-change refusal fired on a closed change.
- Found: a command the device does not accept (`ntp server ...` on a cEOS device) is refused at validation, as intended.
- Not verified: a licence or permission refusal (the account is licensed), a PAN-OS device, a large network, the content of
  the predicted snapshot, the async close/cancel rule firing on a real close, and what the `basic` REST log level records.

### Cleanup rule and buttons (2026-10-31)

- Verified on the PDI: cancelling a change fired the async cleanup rule. A finished run's change set was deleted (Forward's 404
  for a change set that does not exist counted as gone), a stuck `starting` run was ended as "stopped by cleanup" with its
  claim released, and the proposed commands were purged. The change model does not allow jumping to Closed from New, so the
  Closed branch of the same rule condition was not exercised.
- Verified on the PDI: the server halves of the Proposals, Start (refuses while Predict is off, with its fixed phrase) and
  Refresh buttons. The Start confirmation dialog runs in the browser and has not been clicked.

