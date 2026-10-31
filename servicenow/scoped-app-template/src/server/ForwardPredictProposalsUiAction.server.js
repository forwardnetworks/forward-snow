(function () {
  // Opens the proposals for this change. New rows made from that list start with the change filled in.
  var id = String(current.getUniqueValue());
  action.setRedirectURL("/__SCOPE___predict_proposal_list.do?sysparm_query=change%3D" + id + "&sysparm_query_encoded=change%3D" + id);
})();
