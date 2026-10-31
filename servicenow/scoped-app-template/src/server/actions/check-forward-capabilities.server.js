(function execute(inputs, outputs) {
  // Read-only: asks Forward whether this organisation can use Predict and Forward AI. Nothing is stored or changed.
  var network = String(gs.getProperty("__SCOPE__.forward.predict_network_id", "")).replace(/^\s+|\s+$/g, "");
  var found = new ForwardApiClient().capabilities(/^[A-Za-z0-9_-]{1,64}$/.test(network) ? network : "");
  var word = function (value) { return value === true ? "true" : value === false ? "false" : "unknown"; };
  outputs.predict_available = word(found.predict.available);
  outputs.predict_reason = String(found.predict.reason);
  outputs.ai_available = word(found.ai.available);
  outputs.ai_reason = String(found.ai.reason);
})(inputs, outputs);
