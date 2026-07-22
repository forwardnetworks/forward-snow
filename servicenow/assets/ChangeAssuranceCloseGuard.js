var ChangeAssuranceCloseGuard = Class.create();
ChangeAssuranceCloseGuard.prototype = {
  evaluate: function (change) {
    var failures = [];
    var changeSysId = String(change && change.getUniqueValue ? change.getUniqueValue() : "");
    if (!/^[0-9a-f]{32}$/.test(changeSysId)) failures.push("Change Request identity is invalid");
    if (this._value(change, "__SCOPE___assurance_status") !== "completed") {
      failures.push("assurance lifecycle is not completed");
    }
    if (this._value(change, "__SCOPE___assurance_decision") !== "pass") {
      failures.push("assurance decision is not PASS");
    }

    var evidence = changeSysId ? this._latestEvidence(changeSysId) : null;
    if (!evidence) {
      failures.push("published assurance evidence is missing");
      return { allowed: false, failures: failures };
    }
    this._require(evidence, "u_lifecycle_state", "complete", "evidence lifecycle is not complete", failures);
    this._require(evidence, "u_decision", "pass", "published evidence decision is not PASS", failures);
    this._require(evidence, "u_publication_status", "published", "evidence publication is incomplete", failures);
    this._require(evidence, "u_reconciliation_state", "reconciled", "Forward reconciliation is not complete", failures);
    this._require(evidence, "u_dynatrace_service_health", "HEALTHY", "Dynatrace service health is not HEALTHY", failures);
    if (parseInt(this._value(evidence, "u_dynatrace_open_problem_count") || "0", 10) !== 0) {
      failures.push("Dynatrace still has open problems");
    }
    var beforeSnapshot = this._value(evidence, "u_before_snapshot_id");
    var afterSnapshot = this._value(evidence, "u_after_snapshot_id");
    if (!beforeSnapshot || !afterSnapshot || beforeSnapshot === afterSnapshot) {
      failures.push("distinct before and after Forward snapshots are required");
    }
    ["u_preflight_sha256", "u_gate_sha256", "u_evidence_sha256"].forEach(function (field) {
      if (!/^[0-9a-f]{64}$/.test(this._value(evidence, field))) failures.push(field + " is not a valid SHA-256");
    }, this);
    if (!/^[0-9a-f]{32}$/.test(this._value(evidence, "u_attachment"))) {
      failures.push("checksum-bound evidence attachment is missing");
    }
    return { allowed: failures.length === 0, failures: failures, evidenceSysId: String(evidence.getUniqueValue() || "") };
  },

  _latestEvidence: function (changeSysId) {
    var record = new GlideRecord(this._assuranceTable());
    record.addQuery("u_change_request", changeSysId);
    record.orderByDesc("sys_created_on");
    record.setLimit(1);
    record.query();
    return record.next() ? record : null;
  },

  _assuranceTable: function () {
    return "__SCOPE___assurance";
  },

  _value: function (record, field) {
    if (!record || !record.isValidField || !record.isValidField(field)) return "";
    return String(record.getValue(field) || "");
  },

  _require: function (record, field, expected, message, failures) {
    if (this._value(record, field).toLowerCase() !== String(expected).toLowerCase()) failures.push(message);
  },

  type: "ChangeAssuranceCloseGuard",
};

if (typeof module !== "undefined" && module.exports) module.exports = ChangeAssuranceCloseGuard;
