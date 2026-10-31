(function executeRule(current, previous) {
  // A binding judges one query version, and only Bind may set it.
  if (current.operation() === "insert") {
    // A criterion created with a binding already filled in (REST, import) is not trusted.
    current.setValue("query_id", "");
    current.setValue("commit_id", "");
    current.setValue("binding_note", "");
    return;
  }
  // The criterion cannot be moved to another change.
  if (current.change.changes()) current.setValue("change", previous.getValue("change"));
  // Changing the path makes the old binding wrong, so it is cleared and the criterion cannot run until it is bound again.
  if (current.query_path.changes()) {
    current.setValue("query_id", "");
    current.setValue("commit_id", "");
    current.setValue("binding_note", "");
  }
})(current, previous);
