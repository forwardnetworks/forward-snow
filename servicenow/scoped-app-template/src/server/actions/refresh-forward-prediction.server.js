(function execute(inputs, outputs) {
  var result = new ForwardPredict().refresh(String(inputs.change_sys_id || ""));
  outputs.outcome = result.outcome;
  outputs.predicted_snapshot_id = result.predictedSnapshotId;
  outputs.stale = result.stale ? "true" : "false";
})(inputs, outputs);
