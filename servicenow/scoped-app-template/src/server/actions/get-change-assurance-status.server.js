(function execute(inputs, outputs) {
  var result = new ChangeAssuranceFlowClient().status(String(inputs.run_id || ""));
  outputs.run_id = result.runId;
  outputs.status = result.status;
  outputs.phase = result.phase;
  outputs.decision = result.decision || "";
  outputs.network_id = result.forward && result.forward.networkId || "";
  outputs.before_snapshot_id = result.forward && result.forward.beforeSnapshotId || "";
  outputs.after_snapshot_id = result.forward && result.forward.afterSnapshotId || "";
})(inputs, outputs);
