(function executeRule(current, previous) {
  // Any criterion insert, update or delete (a rebind counts) makes an earlier verdict describe criteria that have changed.
  var changeId = String(current.getValue("change") || "");
  if (!changeId) return;
  var change = new GlideRecord("change_request");
  if (!change.get(changeId)) return;
  var revision = parseInt(change.getValue("__SCOPE___criteria_revision") || "0", 10) || 0;
  change.setValue("__SCOPE___criteria_revision", revision + 1);
  var status = String(change.getValue("__SCOPE___validation_status") || "not_run");
  if (status !== "not_run") {
    change.setValue("__SCOPE___validation_status", "stale");
    // No score on a stale verdict, so a policy that reads only the score cannot keep passing on it.
    change.setValue("__SCOPE___validation_score", "");
  }
  // Quiet write: this must not run other rules (the close guard) or change the change's update fields.
  change.autoSysFields(false);
  change.setWorkflow(false);
  change.update();
})(current, previous);
