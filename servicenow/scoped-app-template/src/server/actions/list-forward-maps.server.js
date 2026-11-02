(function execute(inputs, outputs) {
  var result = new ForwardMapsLookup().forChange(String(inputs.change_sys_id || ""));
  outputs.maps_json = JSON.stringify(result.matches);
  outputs.match_count = result.matchCount;
  outputs.note = result.note;
})(inputs, outputs);
