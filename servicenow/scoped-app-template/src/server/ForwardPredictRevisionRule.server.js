(function executeRule(current, previous) {
  // Insert, update and delete all count: a deleted proposal makes an earlier prediction stale too.
  var changeId = String(current.getValue("change") || "");
  if (!changeId) return;
  var change = new GlideRecord("change_request");
  if (!change.get(changeId)) return;
  var revision = parseInt(change.getValue("__SCOPE___predict_revision") || "0", 10) || 0;
  change.setValue("__SCOPE___predict_revision", revision + 1);
  // Quiet write: this must not run other rules (the close guard) or change the change's update fields.
  change.autoSysFields(false);
  change.setWorkflow(false);
  change.update();
})(current, previous);
