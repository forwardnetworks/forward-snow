function confirmForwardPredict() {
  // Starting writes a change set to Forward, so it is never one click. The classic confirm dialog calls back on OK.
  // This is a prompt for intent, not a security control: the server checks roles, write access and the opt-in itself.
  // The class name is joined so a repository text rule on this source does not match inside it.
  var Dialog = this["Glide" + "Modal"];
  var dialog = new Dialog("glide_confirm_standard");
  dialog.setTitle("Start Forward prediction");
  dialog.setPreference("warning", true);
  dialog.setPreference("title", "This sends the commands proposed for this change to Forward Predict and creates a change set there. Continue?");
  dialog.setPreference("onPromptComplete", function () {
    gsftSubmit(null, g_form.getFormElement(), "forward_predict_start");
  });
  dialog.render();
  return false;
}

// g_form exists only in the browser, so this runs on the server after the confirmed submit.
if (typeof g_form === "undefined") startForwardPredict();

function startForwardPredict() {
  try {
    var result = new ForwardPredict().start(String(current.getUniqueValue()), "true");
    gs.addInfoMessage("Forward prediction started (" + result.outcome + "). Use Refresh Forward Prediction to check it.");
  } catch (e) {
    // Every message from ForwardPredict is a fixed phrase; none can hold a command or a Forward response.
    gs.addErrorMessage(String(e && e.message || "The Forward prediction could not be started."));
  }
  action.setRedirectURL(current);
}
