(function execute(inputs, outputs) {
  var result = new ForwardPredict().start(String(inputs.change_sys_id || ""), String(inputs.confirm || ""));
  outputs.outcome = result.outcome;
  outputs.predicted_snapshot_id = result.predictedSnapshotId;
  outputs.run_id = result.runId;
})(inputs, outputs);
