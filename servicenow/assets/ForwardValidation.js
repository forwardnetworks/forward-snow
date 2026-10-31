var ForwardValidation = Class.create();
ForwardValidation.prototype = {
  initialize: function (client) {
    this._client = client || null;
    this._rowLimit = 1001;
    // Score penalties per failing or erroring result, as in forward-netbox.
    this._penalty = { info: 0, warning: 3, error: 10, critical: 25 };
  },

  // Pins active criteria to a query id and commit. Read only against Forward. Criteria that are already pinned are
  // left alone unless rebind is "true", because re-pinning moves a criterion to a newer query version and makes any
  // earlier verdict out of date. A criterion that cannot be pinned is left unbound, with a fixed reason.
  bind: function (changeSysId, rebind) {
    this._requireUser();
    var changeId = this._changeId(changeSysId);
    var change = this._writableChange(changeId);
    this._refuseClosed(change);
    var criteria = this._criteria(changeId);
    this._expireStale(changeId, criteria.length);
    if (this._activeRun(changeId)) throw new Error("a Forward validation is running for this change");
    var client = this._forward();
    var again = String(rebind) === "true";
    var bound = 0;
    var failed = 0;
    var kept = 0;
    for (var i = 0; i < criteria.length; i++) {
      if (criteria[i].queryId && criteria[i].commitId && !again) {
        kept += 1;
        continue;
      }
      var fields;
      try {
        var pinned = client.resolveQuery(criteria[i].queryPath);
        fields = { query_id: pinned.queryId, commit_id: pinned.commitId, binding_note: "pinned" };
        bound += 1;
      } catch (e) {
        fields = { query_id: "", commit_id: "", binding_note: "not pinned: " + this._phrase(e) };
        failed += 1;
      }
      this._saveCriterion(criteria[i].id, fields);
    }
    return { bound: bound, failed: failed, kept: kept };
  },

  // Runs every active criterion against one snapshot and records the verdicts, a score, and the change's status.
  // Rows are reduced to counts in memory; nothing from a row is stored, logged or returned.
  run: function (changeSysId, snapshotId, baselineSnapshotId) {
    this._requireUser();
    var changeId = this._changeId(changeSysId);
    var change = this._writableChange(changeId);
    this._refuseClosed(change);
    var networkId = String(gs.getProperty("__SCOPE__.forward.network_id", "")).replace(/^\s+|\s+$/g, "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(networkId)) throw new Error("forward.network_id is not set to a valid Forward network ID");
    var maxCriteria = parseInt(gs.getProperty("__SCOPE__.forward.validation_max_criteria", "20"), 10);
    if (!isFinite(maxCriteria) || maxCriteria < 1 || maxCriteria > 100) throw new Error("forward.validation_max_criteria must be between 1 and 100");

    // Taken before the criteria are read, so an edit made while this runs makes the verdict stale.
    var revision = parseInt(change.getValue("__SCOPE___criteria_revision") || "0", 10) || 0;
    var criteria = this._criteria(changeId);
    if (!criteria.length) throw new Error("this change has no active criteria");
    if (criteria.length > maxCriteria) throw new Error("this change has more criteria than forward.validation_max_criteria");
    for (var u = 0; u < criteria.length; u++) {
      if (!criteria[u].queryId || !criteria[u].commitId) throw new Error("a criterion is not pinned to a query version; bind the criteria first");
    }

    this._expireStale(changeId, criteria.length);
    var run = this._claim(changeId);
    try {
      var client = this._forward();
      // Only snapshots of the configured network are used, so a run can never read another network.
      var listed = client.listSnapshots(networkId);
      var snapshot = String(snapshotId || "") || new ForwardPathCheck(client).latestProcessedSnapshot(listed);
      if (!snapshot) throw this._refusal("no_snapshot");
      if (!this._isUsable(listed, snapshot)) throw this._refusal("foreign_snapshot");
      var baseline = String(baselineSnapshotId || "") || this._assuranceBaseline(changeId, networkId);
      if (baseline && !this._isUsable(listed, baseline)) throw this._refusal("foreign_snapshot");
      this._save(run, { snapshot_id: snapshot, baseline_snapshot_id: baseline, revision: revision });

      var tally = { pass: 0, fail: 0, error: 0, skipped: 0, penalty: 0 };
      for (var i = 0; i < criteria.length; i++) {
        this._assertOwned(run, changeId);
        var verdict = this._judge(client, criteria[i], snapshot, baseline);
        tally[verdict.status] += 1;
        if (verdict.status === "fail" || verdict.status === "error") tally.penalty += this._penaltyFor(criteria[i].severity);
        this._result(run, criteria[i], verdict);
      }
      this._assertOwned(run, changeId);
      var measured = tally.pass + tally.fail + tally.error;
      var score = measured > 0 ? Math.max(0, 100 - tally.penalty) : "";
      // pass needs every criterion measured and passing. Errors and skips never read as a pass.
      var status = tally.fail > 0 ? "fail" : tally.error > 0 ? "error" : measured === 0 ? "not_run" : tally.skipped > 0 ? "incomplete" : "pass";
      this._save(run, { outcome: "complete", claim: run, passed: tally.pass, failed: tally.fail, errored: tally.error,
        skipped: tally.skipped, score: score });
      this._stamp(change, status, score, snapshot, revision);
      return { runId: run, status: status, score: score, passed: tally.pass, failed: tally.fail, errored: tally.error, skipped: tally.skipped };
    } catch (e) {
      this._end(run, this._phrase(e));
      throw new Error("Forward validation could not be completed: " + this._phrase(e));
    }
  },

  // One criterion, one verdict. A question Forward could not answer is an error and one nothing measured is skipped;
  // neither is ever a pass.
  _judge: function (client, criterion, snapshot, baseline) {
    try {
      if (criterion.expectation === "no_diff" && !baseline) return { status: "skipped", rowCount: 0, detail: "no baseline snapshot" };
      if (criterion.expectation === "no_rows" || criterion.expectation === "some_rows") {
        // One row is enough to decide, and the total gives the count without holding the rows.
        var probe = client.runQuery(snapshot, criterion.queryId, criterion.commitId, 1);
        var any = probe.total > 0 || probe.count > 0;
        if (criterion.expectation === "no_rows") {
          return any ? { status: "fail", rowCount: probe.total, detail: "rows were returned" } : { status: "pass", rowCount: 0, detail: "no rows" };
        }
        return any ? { status: "pass", rowCount: probe.total, detail: "rows were returned" } : { status: "fail", rowCount: 0, detail: "no rows" };
      }
      if (criterion.expectation === "no_diff") {
        var now = client.runQuery(snapshot, criterion.queryId, criterion.commitId, this._rowLimit);
        var before = client.runQuery(baseline, criterion.queryId, criterion.commitId, this._rowLimit);
        if (now.truncated || before.truncated) return { status: "error", rowCount: now.count, detail: "too many rows to compare" };
        return this._sameSet(now.rowKeys, before.rowKeys)
          ? { status: "pass", rowCount: now.count, detail: "same rows as the baseline" }
          : { status: "fail", rowCount: now.count, detail: "rows differ from the baseline" };
      }
      return { status: "error", rowCount: 0, detail: "unknown expectation" };
    } catch (e) {
      return { status: "error", rowCount: 0, detail: "Forward could not answer: " + (e && e.kind ? e.kind : "error") };
    }
  },

  _sameSet: function (a, b) {
    var seen = {};
    var i;
    for (i = 0; i < a.length; i++) seen[a[i]] = 1;
    var other = {};
    for (i = 0; i < b.length; i++) other[b[i]] = 1;
    var keysA = Object.keys(seen);
    if (keysA.length !== Object.keys(other).length) return false;
    for (i = 0; i < keysA.length; i++) if (!other[keysA[i]]) return false;
    return true;
  },

  _penaltyFor: function (severity) {
    var value = this._penalty[String(severity || "error")];
    return value === undefined ? this._penalty.error : value;
  },

  // ---- data ----

  _criteria: function (changeId) {
    var rows = new GlideRecord("__SCOPE___criterion");
    rows.addQuery("change", changeId);
    rows.addQuery("active", "true");
    rows.orderBy("name");
    // One more than the largest allowed cap, so a change over the cap is seen and refused, never trimmed.
    rows.setLimit(101);
    rows.query();
    var list = [];
    while (rows.next()) {
      list.push({
        id: String(rows.getUniqueValue()),
        queryPath: String(rows.getValue("query_path") || ""),
        expectation: String(rows.getValue("expectation") || ""),
        severity: String(rows.getValue("severity") || "error"),
        queryId: String(rows.getValue("query_id") || ""),
        commitId: String(rows.getValue("commit_id") || ""),
      });
    }
    return list;
  },

  _saveCriterion: function (id, fields) {
    var row = new GlideRecord("__SCOPE___criterion");
    if (!row.get(id)) return;
    var names = Object.keys(fields);
    for (var i = 0; i < names.length; i++) row.setValue(names[i], fields[names[i]]);
    row.update();
  },

  // The newest assurance record's baseline, used only when it names the same network that is being validated.
  _assuranceBaseline: function (changeId, networkId) {
    var rows = new GlideRecord("__SCOPE___assurance");
    rows.addQuery("change_request", changeId);
    rows.orderByDesc("sys_created_on");
    rows.setLimit(1);
    rows.query();
    if (!rows.next()) return "";
    var recorded = String(rows.getValue("forward_network_id") || "");
    if (recorded && recorded !== networkId) return "";
    return String(rows.getValue("before_snapshot_id") || "");
  },

  // A snapshot of the configured network that Forward itself would call a real one: processed, not a draft, a fork,
  // or a prediction. A verdict against a predicted snapshot must never look like one against the network.
  _isUsable: function (snapshots, id) {
    for (var i = 0; i < snapshots.length; i++) {
      var item = snapshots[i];
      if (item.id !== id) continue;
      return item.state === "PROCESSED" && !item.isDraft && !item.parentSnapshotId &&
        item.processingTrigger !== "PREDICT" && item.processingTrigger !== "FORK";
    }
    return false;
  },

  _activeRun: function (changeId) {
    var rows = new GlideRecord("__SCOPE___validation_run");
    rows.addQuery("claim", changeId);
    rows.setLimit(1);
    rows.query();
    return rows.next();
  },

  _refuseClosed: function (change) {
    var state = String(change.getValue("state") || "");
    if (state === "3" || state === "4") throw new Error("this change is closed or cancelled");
  },

  // The unique claim holds the change id while a run is active, so a second run's insert fails.
  _claim: function (changeId) {
    var row = new GlideRecord("__SCOPE___validation_run");
    row.initialize();
    row.setValue("change", changeId);
    row.setValue("claim", changeId);
    row.setValue("outcome", "running");
    row.setValue("started_ms", String(new Date().getTime()));
    var id = row.insert();
    if (!id) throw new Error("a Forward validation is already running for this change");
    return String(id);
  },

  _assertOwned: function (runId, changeId) {
    var row = new GlideRecord("__SCOPE___validation_run");
    if (row.get(runId) && String(row.getValue("outcome")) === "running" && String(row.getValue("claim")) === changeId) return;
    var error = new Error("claim lost");
    error.lostClaim = true;
    throw error;
  },

  _expireStale: function (changeId, criteriaCount) {
    var rows = new GlideRecord("__SCOPE___validation_run");
    rows.addQuery("claim", changeId);
    rows.setLimit(1);
    rows.query();
    if (!rows.next()) return;
    var timeout = parseInt(gs.getProperty("__SCOPE__.forward.timeout_ms", "30000"), 10);
    if (!isFinite(timeout) || timeout < 1000 || timeout > 120000) timeout = 120000;
    // Each criterion makes up to two query calls, plus the snapshot list.
    var limit = (2 * criteriaCount + 2) * timeout + 60000;
    var age = new Date().getTime() - (parseInt(rows.getValue("started_ms") || "0", 10) || 0);
    if (age > limit) {
      var id = String(rows.getUniqueValue());
      this._save(id, { outcome: "error", claim: id, detail: "expired" });
    }
  },

  _end: function (runId, phrase) {
    try {
      var row = new GlideRecord("__SCOPE___validation_run");
      if (!row.get(runId)) return;
      // A run that lost its claim keeps whatever outcome ended it.
      if (String(row.getValue("outcome")) !== "running") return;
      this._save(runId, { outcome: "error", claim: runId, detail: phrase });
    } catch (e) {
      // The caller is already failing; the run expires on its own.
    }
  },

  _save: function (runId, fields) {
    var row = new GlideRecord("__SCOPE___validation_run");
    if (!row.get(runId)) throw new Error("validation run was not found");
    var names = Object.keys(fields);
    for (var i = 0; i < names.length; i++) row.setValue(names[i], fields[names[i]]);
    if (!row.update()) throw new Error("the validation run could not be saved");
  },

  _result: function (runId, criterion, verdict) {
    var row = new GlideRecord("__SCOPE___validation_result");
    row.initialize();
    row.setValue("run", runId);
    row.setValue("criterion", criterion.id);
    // The version that was actually run, so a verdict can be traced even if the criterion is re-pinned later.
    row.setValue("query_id", criterion.queryId);
    row.setValue("commit_id", criterion.commitId);
    row.setValue("status", verdict.status);
    row.setValue("row_count", verdict.rowCount);
    row.setValue("detail", String(verdict.detail).substring(0, 200));
    if (!row.insert()) throw new Error("a validation result could not be saved");
  },

  // Quiet write: it must not run the close guard or other rules, or change the change's update fields.
  _stamp: function (change, status, score, snapshot, revision) {
    var row = new GlideRecord("change_request");
    if (!row.get(change.getUniqueValue())) return;
    var current = parseInt(row.getValue("__SCOPE___criteria_revision") || "0", 10) || 0;
    // Criteria edited while the run was going: the verdict describes criteria that no longer exist.
    row.setValue("__SCOPE___validation_status", current === revision ? status : "stale");
    // A stale verdict keeps no score, so a policy that reads only the score cannot keep passing on it.
    var fresh = current === revision;
    row.setValue("__SCOPE___validation_score", fresh && score !== "" ? score : "");
    row.setValue("__SCOPE___validation_snapshot_id", snapshot);
    row.autoSysFields(false);
    row.setWorkflow(false);
    row.update();
  },

  // ---- helpers ----

  _forward: function () {
    if (!this._client) this._client = new ForwardApiClient();
    return this._client;
  },

  _requireUser: function () {
    if (String(gs.getUserName()) === "system") throw new Error("run this action as a user, not as System");
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

  _refusal: function (reason) {
    var error = new Error("refused");
    error.reason = reason;
    return error;
  },

  _phrase: function (e) {
    if (e && e.reason === "no_snapshot") return "no processed snapshot in the network";
    if (e && e.reason === "foreign_snapshot") return "a snapshot is not one of the configured network's";
    if (e && e.lostClaim) return "the run was ended by another request";
    var kinds = {
      unauthorized: "Forward rejected the credentials",
      forbidden: "Forward refused the request",
      not_found: "Forward did not find the network or snapshot",
      rate_limited: "Forward is rate limiting requests",
      server: "Forward returned a server error",
      unreachable: "Forward could not be reached",
      invalid_response: "Forward returned an unexpected response",
      invalid_request: "a setting was not accepted",
    };
    return e && kinds[e.kind] ? kinds[e.kind] : "unexpected error";
  },

  type: "ForwardValidation",
};

if (typeof module !== "undefined" && module.exports) module.exports = ForwardValidation;
