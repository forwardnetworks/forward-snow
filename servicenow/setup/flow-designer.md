# Purchase-Free Flow Designer Setup

This integration uses Workflow Studio core Script steps and `ChangeAssuranceFlowClient`. It does not require the paid
IntegrationHub REST step. The Script Include uses the platform `sn_ws.RESTMessageV2` API with a Basic Auth Profile and
calls the asynchronous worker packaged in the companion `forward-dynatrace` runtime.

## Prerequisites

1. Deploy `servicenow-flow-server` from the companion runtime behind a customer-owned private HTTPS endpoint.
2. Create a dedicated Basic Auth Profile whose username/password match `SERVICENOW_FLOW_USERNAME` and
   `SERVICENOW_FLOW_PASSWORD` on the worker.
3. Configure the field integration:

```bash
export SN_ASSURANCE_WORKER_BASE_URL='https://forward-assurance.example.com'
export SN_ASSURANCE_WORKER_AUTH_PROFILE_SYS_ID='<32-character Basic Auth Profile sys_id>'
python3 scripts/install_servicenow_demo.py
```

The installer writes an exact origin allowlist. It never stores worker credentials in a custom table or property.
It also records the Scripted REST API's authoritative, ServiceNow-assigned `base_uri` in
`x_fwd_demo.assurance.ingress_base_uri`; configure the Forward-side conductor from that non-secret value rather than
assuming the global `/api/now/...` namespace.

## Action 1: Start Forward Change Assurance

Create a custom action with these inputs:

- `change_number` — String
- `deployment_id` — String
- `affected_records_json` — String containing a JSON array of `{ "table", "sysId" }` CI/service references
- `dependencies_json` — optional String containing a JSON array

Add a core Script step:

```javascript
(function execute(inputs, outputs) {
  var options = {
    changeNumber: String(inputs.change_number),
    deploymentId: String(inputs.deployment_id),
    affectedRecords: JSON.parse(String(inputs.affected_records_json))
  };
  if (inputs.dependencies_json) {
    options.dependencies = JSON.parse(String(inputs.dependencies_json));
  }
  var run = new ChangeAssuranceFlowClient().start(options);
  outputs.run_id = run.runId;
  outputs.status = run.status;
  outputs.before_snapshot_id = run.forward && run.forward.beforeSnapshotId || "";
})(inputs, outputs);
```

Add String outputs `run_id`, `status`, and `before_snapshot_id`.

The worker resolves these ServiceNow record references through its protected, versioned mapping file. Do not add
Forward network IDs, Dynatrace entity IDs, endpoint mappings, or credentials as Flow inputs. The response exposes only
the bounded resolved scope needed for status and completion.

Use this action from a Change Request record trigger only after the customer-defined approval, executable-state, and
window conditions match. The worker repeats the authoritative checks and remains the enforcement boundary.

## Action 2: Get Forward Change Assurance Status

Input: `run_id` String. Outputs: `status`, `phase`, `decision`, `before_snapshot_id`, `after_snapshot_id`, and `error`.

```javascript
(function execute(inputs, outputs) {
  var run = new ChangeAssuranceFlowClient().status(String(inputs.run_id));
  outputs.status = run.status;
  outputs.phase = run.phase;
  outputs.decision = run.decision || "";
  outputs.before_snapshot_id = run.forward && run.forward.beforeSnapshotId || "";
  outputs.after_snapshot_id = run.forward && run.forward.afterSnapshotId || "";
  outputs.error = run.error || "";
})(inputs, outputs);
```

Use status for operator inspection and bounded retry logic. Do not create a high-frequency polling flow.

## Action 3: Complete Forward Change Assurance

Inputs:

- `run_id`
- `change_number`
- `deployment_id`
- `observed_at`
- `deployment_state` — `SUCCEEDED`, `FAILED`, `IN_PROGRESS`, or `UNKNOWN`
- `service_health` — `HEALTHY`, `DEGRADED`, `UNHEALTHY`, or `UNKNOWN`
- `open_problem_count` — Integer

```javascript
(function execute(inputs, outputs) {
  var client = new ChangeAssuranceFlowClient();
  var scopedRun = client.status(String(inputs.run_id));
  var context = {
    schemaVersion: "forward-dynatrace-change-context/v1",
    changeId: String(inputs.change_number),
    deploymentId: String(inputs.deployment_id),
    observedAt: String(inputs.observed_at),
    serviceEntityIds: scopedRun.change.serviceEntityIds,
    dynatrace: {
      deploymentState: String(inputs.deployment_state),
      serviceHealth: String(inputs.service_health),
      openProblemCount: parseInt(String(inputs.open_problem_count), 10)
    }
  };
  var run = client.complete(String(inputs.run_id), context);
  outputs.status = run.status;
  outputs.decision = run.decision || "";
})(inputs, outputs);
```

The mapped service scope comes from the worker run, not a second operator input. The remaining context inputs must come
from the customer-approved deployment and Dynatrace evidence path. Do not infer healthy Dynatrace state merely because
the ServiceNow change is approved.

## Recommended Flows

Use separate record-triggered flows instead of one long-running flow:

1. **Baseline flow:** when the Change Request enters its approved implementation window, call Start and store `run_id`
   in `change_request.u_forward_assurance_run_id`. Update `u_forward_assurance_status` from the action output.
2. **Completion flow:** when the deployment system records completion, call Complete with the fresh Dynatrace context.
3. **Decision flow:** when the assurance ledger reaches `complete`, route `pass`, `warn`, and `fail` to customer-owned
   promotion, review, or rollback handling, and copy the bounded result to
   `change_request.u_forward_assurance_status` / `u_forward_assurance_decision`. Never auto-remediate Forward intent.

The final evidence callback updates the assurance ledger and Change Request work note. That record update should drive
the decision flow; no IntegrationHub polling action is needed.

## Validation

- Test one approved and one blocked Change Request.
- Verify the same Start input returns the same run ID.
- Verify modified retry input is rejected.
- Complete once with safe evidence and once with regression evidence.
- Read back the ledger attachment SHA-256 and work-note marker.
- Retry completion and verify there is no duplicate ledger, attachment, or work note.
