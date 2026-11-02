(function execute(inputs, outputs) {
  var result = new ForwardValidation().run(String(inputs.change_sys_id || ""), String(inputs.snapshot_id || ""), String(inputs.baseline_snapshot_id || ""));
  outputs.status = result.status;
  outputs.score = String(result.score);
  outputs.run_id = result.runId;
  outputs.passed = result.passed;
  outputs.failed = result.failed;
  outputs.errored = result.errored;
  outputs.skipped = result.skipped;
})(inputs, outputs);
