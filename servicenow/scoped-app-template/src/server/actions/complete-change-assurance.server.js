(function execute(inputs, outputs) {
  var text = String(inputs.context_json || "").replace(/^\s+|\s+$/g, "");
  var context;
  if (!text) throw new Error("context_json is required");
  try {
    context = JSON.parse(text);
  } catch (e) {
    throw new Error("context_json must be valid JSON");
  }
  var result = new ChangeAssuranceFlowClient().complete(String(inputs.run_id || ""), context);
  outputs.run_id = result.runId;
  outputs.status = result.status;
  outputs.phase = result.phase;
  outputs.decision = result.decision || "";
  outputs.network_id = result.forward && result.forward.networkId || "";
  outputs.before_snapshot_id = result.forward && result.forward.beforeSnapshotId || "";
  outputs.after_snapshot_id = result.forward && result.forward.afterSnapshotId || "";
})(inputs, outputs);
