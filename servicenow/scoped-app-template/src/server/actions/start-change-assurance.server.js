(function execute(inputs, outputs) {
  function parseJson(value, label, optional) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    if (!text && optional) return null;
    if (!text) throw new Error(label + " is required");
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(label + " must be valid JSON");
    }
  }

  var options = {
    changeNumber: String(inputs.change_number || ""),
    deploymentId: String(inputs.deployment_id || ""),
    affectedRecords: parseJson(inputs.affected_records_json, "affected_records_json", false),
  };
  var instanceAlias = String(inputs.instance_alias || "").replace(/^\s+|\s+$/g, "");
  if (instanceAlias) options.instanceAlias = instanceAlias;
  var dependencies = parseJson(inputs.dependencies_json, "dependencies_json", true);
  if (dependencies) options.dependencies = dependencies;
  if (String(inputs.retry || "false") === "true") options.retry = true;

  var result = new ChangeAssuranceFlowClient().start(options);
  outputs.run_id = result.runId;
  outputs.status = result.status;
  outputs.phase = result.phase;
  outputs.decision = result.decision || "";
  outputs.network_id = result.forward && result.forward.networkId || "";
  outputs.before_snapshot_id = result.forward && result.forward.beforeSnapshotId || "";
  outputs.after_snapshot_id = result.forward && result.forward.afterSnapshotId || "";
})(inputs, outputs);
