(function execute(inputs, outputs) {
  var result = new ForwardPathCheck().run(String(inputs.validation_sys_id || ""), String(inputs.pinned_snapshot_id || ""));
  outputs.validation_status = result.status;
  outputs.observed_outcome = result.observedOutcome;
  outputs.snapshot_id = result.snapshotId;
})(inputs, outputs);
