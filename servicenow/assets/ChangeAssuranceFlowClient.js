var ChangeAssuranceFlowClient = Class.create();
ChangeAssuranceFlowClient.prototype = {
  initialize: function () {
    this._baseUrl = String(gs.getProperty("x_fwd_demo.assurance.worker_base_url", "") || "").replace(/\/+$/, "");
    this._allowedBaseUrls = String(gs.getProperty("x_fwd_demo.assurance.worker_allowed_base_urls", "") || "");
    this._authProfileSysId = String(gs.getProperty("x_fwd_demo.assurance.worker_auth_profile", "") || "");
    this._timeoutMs = parseInt(gs.getProperty("x_fwd_demo.assurance.worker_timeout_ms", "30000"), 10);
    this._maxPayloadBytes = parseInt(gs.getProperty("x_fwd_demo.assurance.worker_max_payload_bytes", "524288"), 10);
    this._validateConfiguration();
  },

  start: function (options) {
    var value = this._object(options, "start options");
    var body = {
      changeNumber: this._requiredString(value.changeNumber, "changeNumber", 32),
      deploymentId: this._requiredString(value.deploymentId, "deploymentId", 255),
      affectedRecords: this._sourceRecordArray(value.affectedRecords, "affectedRecords"),
    };
    if (!/^CHG[0-9]+$/.test(body.changeNumber)) throw new Error("changeNumber must use CHG<number> format");
    if (value.instanceAlias) body.instanceAlias = this._requiredString(value.instanceAlias, "instanceAlias", 128);
    if (value.dependencies != null) {
      if (!Array.isArray(value.dependencies) || !value.dependencies.length || value.dependencies.length > 5000) {
        throw new Error("dependencies must contain between 1 and 5000 rows when supplied");
      }
      body.dependencies = value.dependencies;
    }
    if (value.retry === true) body.retry = true;
    return this._execute("POST", "/v1/servicenow/change-assurance/start", body);
  },

  status: function (runId) {
    return this._execute(
      "GET",
      "/v1/servicenow/change-assurance/runs/" + this._runId(runId),
      null
    );
  },

  complete: function (runId, context) {
    return this._execute(
      "POST",
      "/v1/servicenow/change-assurance/runs/" + this._runId(runId) + "/complete",
      { context: this._object(context, "context") }
    );
  },

  _execute: function (method, relativePath, body) {
    var rm = new sn_ws.RESTMessageV2();
    rm.setHttpMethod(method);
    rm.setEndpoint(this._baseUrl + relativePath);
    rm.setAuthenticationProfile("basic", this._authProfileSysId);
    rm.setHttpTimeout(this._timeoutMs);
    rm.setRequestHeader("Accept", "application/json");
    if (body != null) {
      this._rejectUnsafeContent(body, 0);
      var text = JSON.stringify(body);
      if (!text || this._utf8ByteLength(text) > this._maxPayloadBytes) {
        throw new Error("assurance worker request payload is too large");
      }
      rm.setRequestHeader("Content-Type", "application/json");
      rm.setRequestBody(text);
    }
    var response = rm.execute();
    var status = response.getStatusCode();
    var responseText = String(response.getBody() || "");
    if (this._utf8ByteLength(responseText) > this._maxPayloadBytes) {
      throw new Error("assurance worker response payload is too large");
    }
    var result;
    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      throw new Error("assurance worker returned invalid JSON");
    }
    if (status !== 200 && status !== 202) {
      var message = result && result.message ? String(result.message) : "request failed";
      throw new Error("assurance worker error (" + status + "): " + message.substring(0, 500));
    }
    return this._validateRun(result);
  },

  _validateRun: function (value) {
    var run = this._object(value, "assurance worker response");
    this._assertKnownKeys(run, {
      schemaVersion: true,
      runId: true,
      status: true,
      phase: true,
      createdAt: true,
      updatedAt: true,
      change: true,
      scopeMapping: true,
      forward: true,
      decision: true,
      exitCode: true,
      error: true,
    }, "assurance worker response");
    if (run.schemaVersion !== "forward-dynatrace-servicenow-flow-run/v1") {
      throw new Error("assurance worker response schemaVersion is unsupported");
    }
    this._runId(run.runId);
    var allowed = {
      "start-queued": true,
      "start-running": true,
      "baseline-captured": true,
      blocked: true,
      "complete-queued": true,
      "complete-running": true,
      completed: true,
      failed: true,
    };
    if (!allowed[run.status]) throw new Error("assurance worker response status is unsupported");
    if (["start", "complete"].indexOf(run.phase) < 0) {
      throw new Error("assurance worker response phase is unsupported");
    }
    this._isoDateTime(run.createdAt, "assurance worker response createdAt");
    this._isoDateTime(run.updatedAt, "assurance worker response updatedAt");
    var change = this._object(run.change, "assurance worker response change");
    this._assertKnownKeys(change, {
      number: true,
      deploymentId: true,
      serviceEntityIds: true,
    }, "assurance worker response change");
    var changeNumber = this._requiredString(change.number, "assurance worker response change.number", 32);
    if (!/^CHG[0-9]+$/.test(changeNumber)) throw new Error("assurance worker response change.number is invalid");
    this._requiredString(change.deploymentId, "assurance worker response change.deploymentId", 255);
    this._stringArray(change.serviceEntityIds, "assurance worker response change.serviceEntityIds");
    if (run.scopeMapping != null) {
      var scopeMapping = this._object(run.scopeMapping, "assurance worker response scopeMapping");
      this._assertKnownKeys(scopeMapping, {
        mappingId: true,
        mappingSha256: true,
        environmentId: true,
        sourceRecords: true,
        resolvedAt: true,
        expiresAt: true,
      }, "assurance worker response scopeMapping");
      this._requiredString(scopeMapping.mappingId, "assurance worker response scopeMapping.mappingId", 128);
      if (!/^[a-f0-9]{64}$/.test(String(scopeMapping.mappingSha256 || ""))) {
        throw new Error("assurance worker response scopeMapping.mappingSha256 is invalid");
      }
      this._requiredString(scopeMapping.environmentId, "assurance worker response scopeMapping.environmentId", 128);
      this._sourceRecordArray(scopeMapping.sourceRecords, "assurance worker response scopeMapping.sourceRecords");
      this._isoDateTime(scopeMapping.resolvedAt, "assurance worker response scopeMapping.resolvedAt");
      this._isoDateTime(scopeMapping.expiresAt, "assurance worker response scopeMapping.expiresAt");
    }
    var forward = this._object(run.forward, "assurance worker response forward");
    this._assertKnownKeys(forward, {
      networkId: true,
      beforeSnapshotId: true,
      afterSnapshotId: true,
    }, "assurance worker response forward");
    this._requiredString(forward.networkId, "assurance worker response forward.networkId", 255);
    this._optionalString(forward.beforeSnapshotId, "assurance worker response forward.beforeSnapshotId", 255);
    this._optionalString(forward.afterSnapshotId, "assurance worker response forward.afterSnapshotId", 255);
    if (run.decision != null && ["pass", "warn", "fail"].indexOf(run.decision) < 0) {
      throw new Error("assurance worker response decision is unsupported");
    }
    if (run.exitCode != null && (typeof run.exitCode !== "number" || !isFinite(run.exitCode) ||
        Math.floor(run.exitCode) !== run.exitCode)) {
      throw new Error("assurance worker response exitCode is invalid");
    }
    this._optionalString(run.error, "assurance worker response error", 1000);
    return run;
  },

  _validateConfiguration: function () {
    if (!this._baseUrl || this._baseUrl.indexOf("https://") !== 0) {
      throw new Error("assurance worker base URL must use https");
    }
    var allowed = this._allowedBaseUrls.split(",");
    var accepted = false;
    for (var i = 0; i < allowed.length; i++) {
      var candidate = String(allowed[i] || "").replace(/^\s+|\s+$/g, "").replace(/\/+$/, "");
      if (candidate && candidate === this._baseUrl) accepted = true;
    }
    if (!accepted) throw new Error("assurance worker base URL is not allowlisted");
    if (!/^[0-9a-f]{32}$/.test(this._authProfileSysId)) {
      throw new Error("assurance worker Basic Auth Profile sys_id is required");
    }
    if (!isFinite(this._timeoutMs) || this._timeoutMs < 1000 || this._timeoutMs > 120000) {
      throw new Error("assurance worker timeout must be between 1000 and 120000 ms");
    }
    if (!isFinite(this._maxPayloadBytes) || this._maxPayloadBytes < 16384 || this._maxPayloadBytes > 1048576) {
      throw new Error("assurance worker payload limit must be between 16384 and 1048576 bytes");
    }
  },

  _rejectUnsafeContent: function (value, depth) {
    if (depth > 24) throw new Error("assurance worker payload nesting is too deep");
    if (typeof value === "string") {
      if (/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+\/-]+=*/i.test(value) ||
          /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i.test(value)) {
        throw new Error("assurance worker payload contains credential-shaped content");
      }
      return;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) this._rejectUnsafeContent(value[i], depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    var forbidden = { password: true, secret: true, token: true, credentials: true, authorizationheader: true };
    for (var key in value) {
      if (!value.hasOwnProperty(key)) continue;
      var normalizedKey = String(key).toLowerCase().replace(/[_-]/g, "");
      if (forbidden[normalizedKey]) throw new Error("assurance worker payload contains forbidden field: " + key);
      this._rejectUnsafeContent(value[key], depth + 1);
    }
  },

  _runId: function (value) {
    var runId = this._requiredString(value, "runId");
    if (!/^fdca-[a-f0-9]{24}$/.test(runId)) throw new Error("runId is invalid");
    return runId;
  },

  _object: function (value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be an object");
    return value;
  },

  _requiredString: function (value, label, maxLength) {
    var text = typeof value === "string" ? value.replace(/^\s+|\s+$/g, "") : "";
    if (!text) throw new Error(label + " must be a non-empty string");
    if (maxLength && text.length > maxLength) throw new Error(label + " exceeds " + maxLength + " characters");
    return text;
  },

  _optionalString: function (value, label, maxLength) {
    if (value == null) return "";
    if (typeof value !== "string") throw new Error(label + " must be a string or null");
    var text = value.replace(/^\s+|\s+$/g, "");
    if (maxLength && text.length > maxLength) throw new Error(label + " exceeds " + maxLength + " characters");
    return text;
  },

  _stringArray: function (value, label) {
    if (!Array.isArray(value) || !value.length || value.length > 100) {
      throw new Error(label + " must contain between 1 and 100 values");
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < value.length; i++) {
      var item = this._requiredString(value[i], label + " item", 255);
      if (seen[item]) throw new Error(label + " must contain unique values");
      seen[item] = true;
      out.push(item);
    }
    return out.sort();
  },

  _sourceRecordArray: function (value, label) {
    if (!Array.isArray(value) || !value.length || value.length > 100) {
      throw new Error(label + " must contain between 1 and 100 records");
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < value.length; i++) {
      var record = this._object(value[i], label + " item");
      this._assertKnownKeys(record, { table: true, sysId: true }, label + " item");
      var table = this._requiredString(record.table, label + " item.table", 80);
      var sysId = this._requiredString(record.sysId, label + " item.sysId", 32).toLowerCase();
      if (!/^[a-z][a-z0-9_]{0,79}$/.test(table)) throw new Error(label + " item.table is invalid");
      if (!/^[0-9a-f]{32}$/.test(sysId)) throw new Error(label + " item.sysId is invalid");
      var key = table + ":" + sysId;
      if (seen[key]) throw new Error(label + " must contain unique records");
      seen[key] = true;
      out.push({ table: table, sysId: sysId });
    }
    return out.sort(function (left, right) {
      var leftKey = left.table + ":" + left.sysId;
      var rightKey = right.table + ":" + right.sysId;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  },

  _assertKnownKeys: function (value, allowed, label) {
    for (var key in value) {
      if (value.hasOwnProperty(key) && !allowed[key]) throw new Error(label + " contains unsupported field: " + key);
    }
  },

  _isoDateTime: function (value, label) {
    var text = this._requiredString(value, label, 64);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) || isNaN(Date.parse(text))) {
      throw new Error(label + " must be an ISO UTC date-time");
    }
    return text;
  },

  _utf8ByteLength: function (value) {
    var text = String(value || "");
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
          text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  },

  type: "ChangeAssuranceFlowClient",
};

if (typeof module !== "undefined" && module.exports) module.exports = ChangeAssuranceFlowClient;
