(function executeRule(current, previous) {
  new ForwardPredict().cleanup(String(current.getUniqueValue()), { purge: false, endStarting: true });
})(current, previous);
