(function executeRule(current, previous) {
  // Runs after the close is committed. Cleanup never throws, so it cannot block or undo the state change.
  new ForwardPredict().cleanup(String(current.getUniqueValue()), { purge: true, endStarting: true });
})(current, previous);
