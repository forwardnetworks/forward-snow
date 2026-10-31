var ForwardPredict = Class.create();
ForwardPredict.prototype = {
  // client is optional; it is only built when a Forward call is needed.
  initialize: function (client) {
    this._client = client || null;
    this._pendingExpiryMs = 6 * 60 * 60 * 1000;
  },

  // Advisory only: nothing in the gate, close guard or verdict reads the run or the proposals.
  // Writes to Forward, so it needs the opt-in property and an explicit confirm of "true".
  // Every thrown error is a fixed phrase. Command text and Forward response bodies never leave this class.
  start: function (changeSysId, confirm) {
    if (String(gs.getUserName()) === "system") throw new Error("run this action as a user, not as System");
    if (String(confirm) !== "true") throw new Error("starting a Forward prediction needs confirm set to true");
    if (gs.getProperty("__SCOPE__.forward.predict_enabled", "false") !== "true") throw new Error("Forward Predict is not enabled");
    var networkId = String(gs.getProperty("__SCOPE__.forward.predict_network_id", "")).replace(/^\s+|\s+$/g, "");
    if (!networkId) throw new Error("forward.predict_network_id is not set");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(networkId)) throw new Error("forward.predict_network_id is not a valid Forward network ID");
    var changeId = this._changeId(changeSysId);
    var change = this._writableChange(changeId);
    var changeState = String(change.getValue("state") || "");
    if (changeState === "3" || changeState === "4") throw new Error("this change is closed or cancelled");
    var maxDevices = parseInt(gs.getProperty("__SCOPE__.forward.predict_max_devices", "10"), 10);
    if (!isFinite(maxDevices) || maxDevices < 1 || maxDevices > 50) throw new Error("forward.predict_max_devices must be between 1 and 50");

    // Taken before the proposals are read, so an edit made while this runs makes the prediction stale.
    var revision = parseInt(change.getValue("__SCOPE___predict_revision") || "0", 10) || 0;
    var proposals = this._proposals(changeId);
    if (!proposals.length) throw new Error("this change has no proposed commands");
    if (proposals.length > maxDevices) throw new Error("this change proposes more devices than forward.predict_max_devices");

    this._expireStale(changeId, true);
    if (this._activeRun(changeId)) throw new Error("a Forward prediction is already running for this change");
    // A re-predict removes the previous change set first. Best effort; a leftover is retried by cleanup later.
    this.cleanup(changeId, { purge: false });

    var run = this._claim(changeId, networkId, revision);
    var number = String(change.getValue("number") || "change");
    var note = number + " " + run.id.substring(0, 8);
    var changeSetId = "";
    try {
      var client = this._forward();
      var snapshotId = new ForwardPathCheck(client).latestProcessedSnapshot(client.listSnapshots(networkId));
      if (!snapshotId) throw this._refusal("no_snapshot");

      this._assertOwned(run, changeId, "");
      changeSetId = client.createChangeSet(networkId, {
        name: number + "-" + run.id.substring(0, 8),
        snapshotId: snapshotId,
        description: "Forward Change Assurance prediction",
        tags: ["forward-change-assurance"],
      });
      this._save(run.id, { change_set_id: changeSetId });

      var i;
      for (i = 0; i < proposals.length; i++) {
        this._assertOwned(run, changeId, changeSetId);
        if (client.validateCommands(networkId, changeSetId, proposals[i].device, proposals[i].commands).errorCount > 0) {
          throw this._refusal("validation");
        }
      }
      for (i = 0; i < proposals.length; i++) {
        this._assertOwned(run, changeId, changeSetId);
        client.setCommands(networkId, changeSetId, proposals[i].device, proposals[i].commands);
      }
      this._assertOwned(run, changeId, changeSetId);
      client.commitChangeSet(networkId, changeSetId, note);
      this._assertOwned(run, changeId, changeSetId);
      var predicted = client.predict(networkId, changeSetId, note);
      // Expiry or cleanup may have ended the run during the predict call; never reopen it.
      this._assertOwned(run, changeId, changeSetId);
      this._save(run.id, { predicted_snapshot_id: predicted, outcome: "pending" });
      return { runId: run.id, outcome: "pending", predictedSnapshotId: predicted };
    } catch (e) {
      var phrase = this._phrase(e);
      var lost = e && e.lostClaim === true;
      this._abandon(run, networkId, changeSetId, phrase, lost);
      throw new Error("Forward prediction could not be started: " + phrase);
    }
  },

  // Reads the predicted snapshot. PROCESSED answers; a failed state fails; anything else stays pending until the
  // claim expires. A request timeout is an error for this call and never an answer.
  refresh: function (changeSysId) {
    if (String(gs.getUserName()) === "system") throw new Error("run this action as a user, not as System");
    var changeId = this._changeId(changeSysId);
    var change = this._writableChange(changeId);
    this._expireStale(changeId, false);
    var run = this._activeRun(changeId) || this._latestRun(changeId);
    if (!run) return { outcome: "none", stale: false, predictedSnapshotId: "" };
    var revision = parseInt(change.getValue("__SCOPE___predict_revision") || "0", 10) || 0;
    var result = { outcome: run.outcome, stale: run.revision !== revision, predictedSnapshotId: run.predictedSnapshotId };
    if (run.outcome !== "pending") return result;

    var snapshots;
    try {
      snapshots = this._forward().predictedSnapshots(run.networkId, run.changeSetId);
    } catch (e) {
      throw new Error("Forward prediction could not be refreshed: " + this._phrase(e));
    }
    var state = "";
    for (var i = 0; i < snapshots.length; i++) if (snapshots[i].id === run.predictedSnapshotId) state = snapshots[i].state;
    var next = "";
    if (state === "PROCESSED") next = "answered";
    else if (state === "FAILED" || state === "CANCELED" || state === "TIMED_OUT" || state === "RESTORE_FAILED") next = "failed";
    if (!next && !state && new Date().getTime() - (parseInt(run.startedMs, 10) || 0) > this._pendingExpiryMs) {
      next = "failed";
      state = "expired";
    }
    if (next) {
      var current = this._runById(run.id);
      // Never reopen or overwrite a run that another call already ended.
      if (current && current.outcome === "pending") {
        this._save(run.id, next === "failed" ? { outcome: "failed", claim: run.id, detail: "Forward reported " + state.toLowerCase() } : { outcome: "answered", claim: run.id });
        result.outcome = next;
      }
    }
    return result;
  },

  // Deletes the change set of every run of this change that still holds one. Never throws: cleanup must not block a
  // state change. It is not gated by the opt-in, so switching the feature off still allows it. A run is marked
  // cleaned only after Forward confirms the change set is gone. purge also drops the proposed commands.
  // options.purge drops the proposed commands. options.endStarting also ends a start that has not created its change
  // set yet (used when the change closes or is deleted), so that start stops at its next ownership check.
  cleanup: function (changeSysId, options) {
    var cleaned = 0;
    try {
      var changeId = this._changeId(changeSysId);
      var runs = new GlideRecord("__SCOPE___predict_run");
      runs.addQuery("change", changeId);
      runs.addQuery("cleanup", "open");
      runs.addQuery("change_set_id", "!=", "");
      runs.query();
      var open = [];
      while (runs.next()) {
        open.push({ id: String(runs.getUniqueValue()), changeSetId: String(runs.getValue("change_set_id")),
          networkId: String(runs.getValue("network_id")), outcome: String(runs.getValue("outcome")) });
      }
      for (var i = 0; i < open.length; i++) {
        try {
          if (this._forward().deleteChangeSet(open[i].networkId, open[i].changeSetId) !== true) continue;
          var fields = { cleanup: "cleaned" };
          if (open[i].outcome === "starting" || open[i].outcome === "pending") {
            fields.outcome = "failed";
            fields.claim = open[i].id;
            fields.detail = "stopped by cleanup";
          }
          this._save(open[i].id, fields);
          cleaned += 1;
        } catch (e) {
          // Left open; the next cleanup retries it.
        }
      }
      if (options && options.endStarting === true) {
        var early = this._activeRun(changeId);
        if (early && early.outcome === "starting" && !early.changeSetId) {
          this._save(early.id, { outcome: "failed", claim: early.id, cleanup: "cleaned", detail: "stopped by cleanup" });
        }
      }
      if (options && options.purge === true) this._purge(changeId);
    } catch (e) {
      // Cleanup is best effort by design.
    }
    return cleaned;
  },

  // ---- helpers ----

  _forward: function () {
    if (!this._client) this._client = new ForwardApiClient();
    return this._client;
  },

  _changeId: function (value) {
    var id = String(value || "");
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("change sys_id is invalid");
    return id;
  },

  _writableChange: function (changeId) {
    var change = new GlideRecordSecure("change_request");
    if (!change.get(changeId)) throw new Error("change request was not found");
    if (!change.canWrite()) throw new Error("not permitted to update this change request");
    return change;
  },

  _proposals: function (changeId) {
    var rows = new GlideRecord("__SCOPE___predict_proposal");
    rows.addQuery("change", changeId);
    rows.orderBy("device_name");
    rows.setLimit(100);
    rows.query();
    var list = [];
    var seen = {};
    while (rows.next()) {
      var device = String(rows.getValue("device_name") || "");
      var commands = String(rows.getValue("commands") || "");
      if (!device || !commands.replace(/\s+/g, "")) throw new Error("a proposal has no device or no commands");
      if (seen[device]) throw new Error("a device has more than one proposal");
      seen[device] = true;
      list.push({ device: device, commands: commands });
    }
    return list;
  },

  // The unique claim column holds the change id while a run is active, so a second start's insert fails.
  _claim: function (changeId, networkId, revision) {
    var run = new GlideRecord("__SCOPE___predict_run");
    run.initialize();
    run.setValue("change", changeId);
    run.setValue("claim", changeId);
    run.setValue("outcome", "starting");
    run.setValue("cleanup", "open");
    run.setValue("network_id", networkId);
    run.setValue("started_ms", String(new Date().getTime()));
    run.setValue("revision", revision);
    var id = run.insert();
    if (!id) throw new Error("a Forward prediction is already running for this change");
    return { id: String(id) };
  },

  _assertOwned: function (run, changeId, changeSetId) {
    var current = this._runById(run.id);
    if (current && current.outcome === "starting" && current.claim === changeId) return;
    var error = new Error("claim lost");
    error.lostClaim = true;
    throw error;
  },

  // Ends a start that did not finish: delete the change set it made and record a fixed reason.
  _abandon: function (run, networkId, changeSetId, phrase, lost) {
    var cleaned = false;
    if (changeSetId) {
      try {
        cleaned = this._forward().deleteChangeSet(networkId, changeSetId) === true;
      } catch (e) {
        cleaned = false;
      }
    }
    try {
      var current = this._runById(run.id);
      if (!current) return;
      var fields = { change_set_id: changeSetId, cleanup: cleaned || !changeSetId ? "cleaned" : "open" };
      // A start that lost its claim leaves the run's outcome to whoever ended it.
      if (!lost || current.outcome === "starting") {
        fields.outcome = "failed";
        fields.claim = run.id;
        fields.detail = phrase;
      }
      this._save(run.id, fields);
    } catch (e) {
      // The caller is already failing; the run expires on its own.
    }
  },

  // A start makes 2N + 4 Forward calls, each bounded by the HTTP timeout, so a healthy start is never expired.
  // A pending run is only expired here when asked: refresh checks Forward first, so a late refresh still sees an answer.
  _expireStale: function (changeId, includePending) {
    var run = this._activeRun(changeId);
    if (!run) return;
    if (run.outcome === "pending" && !includePending) return;
    var age = new Date().getTime() - (parseInt(run.startedMs, 10) || 0);
    var limit = run.outcome === "starting" ? this._startExpiryMs() : this._pendingExpiryMs;
    if (age > limit) this._save(run.id, { outcome: "failed", claim: run.id, detail: "expired" });
  },

  _startExpiryMs: function () {
    var devices = parseInt(gs.getProperty("__SCOPE__.forward.predict_max_devices", "10"), 10);
    var timeout = parseInt(gs.getProperty("__SCOPE__.forward.timeout_ms", "30000"), 10);
    if (!isFinite(devices) || devices < 1 || devices > 50) devices = 50;
    if (!isFinite(timeout) || timeout < 1000 || timeout > 120000) timeout = 120000;
    return (2 * devices + 4) * timeout + 60000;
  },

  _activeRun: function (changeId) {
    var rows = new GlideRecord("__SCOPE___predict_run");
    rows.addQuery("change", changeId);
    rows.addQuery("claim", changeId);
    rows.setLimit(1);
    rows.query();
    return rows.next() ? this._runFrom(rows) : null;
  },

  _latestRun: function (changeId) {
    var rows = new GlideRecord("__SCOPE___predict_run");
    rows.addQuery("change", changeId);
    rows.orderByDesc("sys_created_on");
    rows.setLimit(1);
    rows.query();
    return rows.next() ? this._runFrom(rows) : null;
  },

  _runById: function (id) {
    var row = new GlideRecord("__SCOPE___predict_run");
    return row.get(id) ? this._runFrom(row) : null;
  },

  _runFrom: function (row) {
    return {
      id: String(row.getUniqueValue()),
      outcome: String(row.getValue("outcome") || ""),
      claim: String(row.getValue("claim") || ""),
      changeSetId: String(row.getValue("change_set_id") || ""),
      predictedSnapshotId: String(row.getValue("predicted_snapshot_id") || ""),
      networkId: String(row.getValue("network_id") || ""),
      startedMs: String(row.getValue("started_ms") || "0"),
      revision: parseInt(row.getValue("revision") || "0", 10) || 0,
    };
  },

  _save: function (runId, fields) {
    var row = new GlideRecord("__SCOPE___predict_run");
    if (!row.get(runId)) throw new Error("prediction run was not found");
    var names = Object.keys(fields);
    for (var i = 0; i < names.length; i++) row.setValue(names[i], fields[names[i]]);
    if (!row.update()) throw new Error("the prediction run could not be saved");
  },

  _purge: function (changeId) {
    var rows = new GlideRecord("__SCOPE___predict_proposal");
    rows.addQuery("change", changeId);
    rows.deleteMultiple();
  },

  _refusal: function (reason) {
    var error = new Error("refused");
    error.reason = reason;
    return error;
  },

  // The only text a caller or a run record ever sees about a failure. Never a response body, never a command.
  _phrase: function (e) {
    if (e && e.reason === "validation") return "Forward refused the proposed commands";
    if (e && e.reason === "no_snapshot") return "no processed snapshot in the predict network";
    if (e && e.lostClaim) return "the run was ended by another request";
    var kinds = {
      unauthorized: "Forward rejected the credentials",
      forbidden: "Forward refused the request (access or licence)",
      not_found: "Forward did not find the network or change set",
      rate_limited: "Forward is rate limiting requests",
      server: "Forward returned a server error",
      unreachable: "Forward could not be reached",
      invalid_response: "Forward returned an unexpected response",
      invalid_request: "a proposal or setting was not accepted",
    };
    return e && kinds[e.kind] ? kinds[e.kind] : "unexpected error";
  },

  type: "ForwardPredict",
};

if (typeof module !== "undefined" && module.exports) module.exports = ForwardPredict;
