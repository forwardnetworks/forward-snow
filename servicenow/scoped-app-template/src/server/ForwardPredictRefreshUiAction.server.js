(function () {
  try {
    var result = new ForwardPredict().refresh(String(current.getUniqueValue()));
    var text = {
      none: "There is no Forward prediction for this change.",
      starting: "The Forward prediction is still being set up.",
      pending: "Forward is still processing the prediction.",
      answered: "Forward finished the prediction (snapshot " + result.predictedSnapshotId + ").",
      failed: "The Forward prediction failed.",
    };
    gs.addInfoMessage((text[result.outcome] || "Forward prediction: " + result.outcome) +
      (result.stale && result.outcome !== "none" ? " The proposal has changed since, so it is out of date." : ""));
  } catch (e) {
    gs.addErrorMessage(String(e && e.message || "The Forward prediction could not be refreshed."));
  }
  action.setRedirectURL(current);
})();
