(function () {
  var lookup = new ForwardMapsLookup();
  try {
    gs.addInfoMessage(lookup.summaryText(lookup.forChange(String(current.getUniqueValue()))));
  } catch (e) {
    // Details (an unbound alias, a bad property) are for administrators, so they go to the log, not to the form.
    gs.error("Forward maps failed: " + String(e && e.message || e));
    gs.addErrorMessage("Forward maps are unavailable. An administrator can see why in the system log.");
  }
  action.setRedirectURL(current);
})();
