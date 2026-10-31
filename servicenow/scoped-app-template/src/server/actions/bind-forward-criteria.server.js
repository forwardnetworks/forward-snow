(function execute(inputs, outputs) {
  var result = new ForwardValidation().bind(String(inputs.change_sys_id || ""), String(inputs.rebind || ""));
  outputs.bound = result.bound;
  outputs.failed = result.failed;
  outputs.kept = result.kept;
})(inputs, outputs);
