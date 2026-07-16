(function executeRule(current, previous) {
  var targetStates = String(gs.getProperty("x_fwd_demo.assurance.enforced_close_states", "3")).split(",");
  var nextState = String(current.getValue("state") || "");
  if (targetStates.indexOf(nextState) < 0 || String(previous.getValue("state") || "") === nextState) return;
  if (!String(current.getValue("u_forward_assurance_run_id") || "")) return;
  var result = new ChangeAssuranceCloseGuard().evaluate(current);
  if (result.allowed) return;
  gs.addErrorMessage("Forward Change Assurance blocked closeout: " + result.failures.join("; "));
  current.setAbortAction(true);
})(current, previous);
