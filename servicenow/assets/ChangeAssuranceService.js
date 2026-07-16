var ChangeAssuranceService = Class.create();
ChangeAssuranceService.prototype = {
  initialize: function () {
    this._contract = new ChangeAssuranceContract();
  },

  ingest: function (changeSysId, payload, expectedEvidenceSha256) {
    var parsed;
    try {
      parsed = this._contract.parse(
        payload,
        gs.getProperty("x_fwd_demo.assurance.max_payload_bytes", "262144")
      );
    } catch (e) {
      throw this._withStatus(e, 400);
    }
    var normalized = parsed.evidence;
    var requestedChangeSysId = String(changeSysId || "").replace(/^\s+|\s+$/g, "");
    if (!/^[0-9a-f]{32}$/.test(requestedChangeSysId)) {
      throw this._error(400, "requested Change Request sys_id is invalid");
    }
    if (requestedChangeSysId !== normalized.changeSysId) {
      throw this._error(409, "requested Change Request does not match assurance evidence");
    }

    var change = this._loadChange(normalized.changeSysId, normalized.changeNumber);
    var evidenceSha256 = String(new GlideDigest().getSHA256Hex(parsed.text)).toLowerCase();
    if (String(expectedEvidenceSha256 || "") !== evidenceSha256) {
      throw this._error(400, "assurance evidence SHA-256 header does not match request body");
    }
    var idempotencyKey = "forward-dynatrace:" + evidenceSha256;
    var record = this._findByIdempotencyKey(idempotencyKey);
    if (!record) record = this._insertLedger(change, normalized, evidenceSha256, idempotencyKey);

    var publication = this._ensurePublication(record, change, normalized, parsed.text, evidenceSha256, idempotencyKey);
    return this._serialize(record, idempotencyKey, publication);
  },

  _loadChange: function (sysId, expectedNumber) {
    var change = new GlideRecord("change_request");
    if (!change.get(sysId)) throw this._error(404, "Change Request not found: " + sysId);
    if (String(change.getValue("number") || "") !== expectedNumber) {
      throw this._error(409, "Change Request number does not match assurance evidence");
    }
    return change;
  },

  _assuranceTable: function () {
    return String(gs.getProperty("x_fwd_demo.tables.change_assurance", "u_forward_change_assurance"));
  },

  _findByIdempotencyKey: function (idempotencyKey) {
    var gr = new GlideRecord(this._assuranceTable());
    gr.addQuery("u_idempotency_key", idempotencyKey);
    gr.setLimit(2);
    gr.query();
    if (!gr.next()) return null;
    var sysId = String(gr.getUniqueValue() || "");
    if (gr.next()) throw new Error("duplicate assurance records found for idempotency key");
    var result = new GlideRecord(this._assuranceTable());
    if (!result.get(sysId)) throw new Error("assurance record disappeared during lookup");
    return result;
  },

  _insertLedger: function (change, value, evidenceSha256, idempotencyKey) {
    var rec = new GlideRecord(this._assuranceTable());
    rec.initialize();
    rec.short_description = "Forward/Dynatrace assurance: " + value.changeNumber + " " + value.deploymentId;
    this._set(rec, "u_change_request", change.getUniqueValue());
    this._set(rec, "u_run_id", "servicenow-assurance-" + evidenceSha256.substring(0, 16));
    this._set(rec, "u_idempotency_key", idempotencyKey);
    this._set(rec, "u_deployment_id", value.deploymentId);
    this._set(rec, "u_service_entity_ids", value.serviceEntityIds.join(","));
    this._set(rec, "u_lifecycle_state", "evidence_received");
    this._set(rec, "u_decision", value.decision);
    this._set(rec, "u_reason_codes", value.reasonCodes.join(","));
    this._set(rec, "u_forward_network_id", value.networkId);
    this._set(rec, "u_before_snapshot_id", value.beforeSnapshotId);
    this._set(rec, "u_after_snapshot_id", value.afterSnapshotId);
    this._set(rec, "u_reconciliation_run_id", value.reconciliationRunId);
    this._set(rec, "u_reconciliation_state", value.reconciliationState);
    this._set(rec, "u_dynatrace_deployment_state", value.dynatraceDeploymentState);
    this._set(rec, "u_dynatrace_service_health", value.dynatraceServiceHealth);
    this._set(rec, "u_dynatrace_open_problem_count", value.dynatraceOpenProblemCount);
    this._set(rec, "u_preflight_sha256", value.preflightSha256);
    this._set(rec, "u_gate_sha256", value.gateSha256);
    this._set(rec, "u_evidence_sha256", evidenceSha256);
    this._set(rec, "u_generated_at", value.generatedAt);
    this._set(rec, "u_publication_status", "pending");
    var sysId = rec.insert();
    if (!sysId) {
      var existing = this._findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
      throw new Error("failed to insert assurance ledger record");
    }
    if (!rec.get(sysId)) throw new Error("failed to reload assurance ledger record");
    return rec;
  },

  _ensurePublication: function (record, change, value, payloadText, evidenceSha256, idempotencyKey) {
    var fileName = "fwd-dt-assurance-" + evidenceSha256 + ".json";
    var attachmentSysId = this._existingAttachment(record.getUniqueValue(), fileName);
    var attachmentStatus = attachmentSysId ? "existing" : "created";
    try {
      if (!attachmentSysId) {
        attachmentSysId = String(
          new GlideSysAttachment().write(record, fileName, "application/json", payloadText) || ""
        );
      }
      if (!attachmentSysId) throw new Error("ServiceNow did not return an assurance attachment sys_id");
      this._set(record, "u_attachment", attachmentSysId);
      this._set(record, "u_work_note_marker", "[" + idempotencyKey + "]");
      this._set(record, "u_publication_status", "attachment_ready");
      record.update();

      var marker = "[" + idempotencyKey + "]";
      var workNoteSysId = this._workNoteSysId(change.getUniqueValue(), marker);
      var workNoteStatus = workNoteSysId ? "existing" : "created";
      if (!workNoteSysId) {
        change.work_notes = this._contract.workNote(value, evidenceSha256, String(record.number || ""));
        change.update();
        workNoteSysId = this._workNoteSysId(change.getUniqueValue(), marker);
        if (!workNoteSysId) throw new Error("ServiceNow work note was not readable after publication");
      }
      this._set(record, "u_lifecycle_state", "complete");
      this._set(record, "u_publication_status", "published");
      this._set(record, "u_publication_error", "");
      record.update();
      return {
        workNote: { status: workNoteStatus, sysId: workNoteSysId },
        attachment: { status: attachmentStatus, sysId: attachmentSysId },
      };
    } catch (e) {
      this._set(record, "u_lifecycle_state", "error");
      this._set(record, "u_publication_status", "error");
      this._set(record, "u_publication_error", e && e.message ? String(e.message) : "publication failed");
      record.update();
      throw e;
    }
  },

  _existingAttachment: function (recordSysId, fileName) {
    var gr = new GlideRecord("sys_attachment");
    gr.addQuery("table_name", this._assuranceTable());
    gr.addQuery("table_sys_id", recordSysId);
    gr.addQuery("file_name", fileName);
    gr.setLimit(2);
    gr.query();
    if (!gr.next()) return "";
    var sysId = String(gr.getUniqueValue() || "");
    if (gr.next()) throw new Error("duplicate assurance attachments found");
    return sysId;
  },

  _workNoteSysId: function (changeSysId, marker) {
    var gr = new GlideRecord("sys_journal_field");
    gr.addQuery("name", "change_request");
    gr.addQuery("element_id", changeSysId);
    gr.addQuery("element", "work_notes");
    gr.addQuery("value", "CONTAINS", marker);
    gr.setLimit(2);
    gr.query();
    if (!gr.next()) return "";
    var sysId = String(gr.getUniqueValue() || "");
    if (gr.next()) throw new Error("duplicate assurance work notes found");
    return sysId;
  },

  _set: function (gr, field, value) {
    if (gr.isValidField(field)) gr.setValue(field, value == null ? "" : value);
  },

  _error: function (statusCode, message) {
    var error = new Error(message);
    error.statusCode = statusCode;
    return error;
  },

  _withStatus: function (error, statusCode) {
    var tagged = error instanceof Error ? error : new Error("change assurance validation failed");
    tagged.statusCode = statusCode;
    return tagged;
  },

  _serialize: function (record, idempotencyKey, publication) {
    return {
      sysId: String(record.getUniqueValue() || ""),
      number: String(record.number || ""),
      idempotencyKey: idempotencyKey,
      lifecycleState: String(record.getValue("u_lifecycle_state") || ""),
      decision: String(record.getValue("u_decision") || ""),
      publicationStatus: String(record.getValue("u_publication_status") || ""),
      attachmentSysId: String(record.getValue("u_attachment") || ""),
      publication: publication,
    };
  },

  type: "ChangeAssuranceService",
};

if (typeof module !== "undefined" && module.exports) module.exports = ChangeAssuranceService;
