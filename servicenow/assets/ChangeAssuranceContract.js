var ChangeAssuranceContract = function () {};

ChangeAssuranceContract.prototype = {
  SCHEMA_VERSION: "forward-dynatrace-servicenow-change-assurance-evidence/v1",

  parse: function (payload, maxPayloadBytes) {
    var maxBytes = parseInt(String(maxPayloadBytes || "262144"), 10) || 262144;
    var text;
    var value;
    if (typeof payload === "string") {
      text = payload;
      if (!text || this._utf8ByteLength(text) > maxBytes) {
        throw new Error("assurance evidence payload size is invalid");
      }
      try {
        value = JSON.parse(text);
      } catch (e) {
        throw new Error("assurance evidence must be valid JSON");
      }
    } else {
      value = payload;
      try {
        text = JSON.stringify(value);
      } catch (e2) {
        throw new Error("assurance evidence must be JSON serializable");
      }
      if (!text || this._utf8ByteLength(text) > maxBytes) {
        throw new Error("assurance evidence payload size is invalid");
      }
    }

    this._rejectUnsafeContent(value, 0);
    return { text: text, evidence: this.validate(value) };
  },

  validate: function (evidence) {
    if (!this._isObject(evidence)) throw new Error("assurance evidence must be an object");
    this._assertKnownKeys(evidence, {
      schemaVersion: true,
      generatedAt: true,
      change: true,
      decision: true,
      reasonCodes: true,
      forward: true,
      dynatrace: true,
      lineage: true,
      preflight: true,
      gate: true,
    }, "assurance evidence");
    if (evidence.schemaVersion !== this.SCHEMA_VERSION) {
      throw new Error("unsupported assurance evidence schemaVersion");
    }

    var generatedAt = this._isoDateTime(evidence.generatedAt, "generatedAt");
    var change = this._object(evidence.change, "change");
    this._assertKnownKeys(change, {
      number: true,
      sysId: true,
      deploymentId: true,
      serviceEntityIds: true,
    }, "change");
    var changeNumber = this._requiredString(change.number, "change.number", 32);
    if (!/^CHG[0-9]+$/.test(changeNumber)) throw new Error("change.number must use CHG<number> format");
    var changeSysId = this._requiredString(change.sysId, "change.sysId");
    if (!/^[0-9a-f]{32}$/.test(changeSysId)) throw new Error("change.sysId must be a 32-character lowercase sys_id");
    var deploymentId = this._requiredString(change.deploymentId, "change.deploymentId", 255);
    var serviceEntityIds = this._stringArray(change.serviceEntityIds, "change.serviceEntityIds", 100, 255, 4000);

    var decision = this._requiredString(evidence.decision, "decision").toLowerCase();
    if (["pass", "warn", "fail"].indexOf(decision) < 0) throw new Error("decision must be pass, warn, or fail");
    var reasonCodes = this._stringArray(evidence.reasonCodes, "reasonCodes", 100, 128, 4000);
    for (var r = 0; r < reasonCodes.length; r++) {
      if (!/^[A-Z][A-Z0-9_]+$/.test(reasonCodes[r])) throw new Error("reasonCodes contains an invalid code");
    }

    var forward = this._object(evidence.forward, "forward");
    this._assertKnownKeys(forward, {
      networkId: true,
      beforeSnapshotId: true,
      afterSnapshotId: true,
      reconciliationRunId: true,
      reconciliationState: true,
    }, "forward");
    var networkId = this._requiredString(forward.networkId, "forward.networkId", 255);
    var beforeSnapshotId = this._requiredString(forward.beforeSnapshotId, "forward.beforeSnapshotId", 255);
    var afterSnapshotId = this._requiredString(forward.afterSnapshotId, "forward.afterSnapshotId", 255);
    if (beforeSnapshotId === afterSnapshotId) throw new Error("before and after snapshots must differ");
    var reconciliationRunId = this._optionalString(
      forward.reconciliationRunId,
      "forward.reconciliationRunId",
      255
    );
    var reconciliationState = this._optionalString(
      forward.reconciliationState,
      "forward.reconciliationState",
      64
    );

    var dynatrace = this._object(evidence.dynatrace, "dynatrace");
    this._assertKnownKeys(dynatrace, {
      deploymentState: true,
      serviceHealth: true,
      openProblemCount: true,
    }, "dynatrace");
    var deploymentState = this._enum(
      dynatrace.deploymentState,
      ["SUCCEEDED", "FAILED", "IN_PROGRESS", "UNKNOWN"],
      "dynatrace.deploymentState"
    );
    var serviceHealth = this._enum(
      dynatrace.serviceHealth,
      ["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"],
      "dynatrace.serviceHealth"
    );
    var openProblemCount = parseInt(String(dynatrace.openProblemCount), 10);
    if (!isFinite(openProblemCount) || openProblemCount < 0 || openProblemCount > 2147483647 ||
        String(openProblemCount) !== String(dynatrace.openProblemCount)) {
      throw new Error("dynatrace.openProblemCount must be a non-negative integer");
    }

    var lineage = this._object(evidence.lineage, "lineage");
    this._assertKnownKeys(lineage, {
      preflightSha256: true,
      gateSha256: true,
      gateEvidence: true,
    }, "lineage");
    var preflightSha256 = this._sha256(lineage.preflightSha256, "lineage.preflightSha256");
    var gateSha256 = this._sha256(lineage.gateSha256, "lineage.gateSha256");
    var gateEvidence = this._object(lineage.gateEvidence, "lineage.gateEvidence");
    this._assertKnownKeys(gateEvidence, {
      contextSha256: true,
      beforePathEvidenceSha256: true,
      afterPathEvidenceSha256: true,
      reconciliationStatusSha256: true,
    }, "lineage.gateEvidence");
    var contextSha256 = this._sha256(gateEvidence.contextSha256, "lineage.gateEvidence.contextSha256");
    var beforePathEvidenceSha256 = this._sha256(
      gateEvidence.beforePathEvidenceSha256,
      "lineage.gateEvidence.beforePathEvidenceSha256"
    );
    var afterPathEvidenceSha256 = this._sha256(
      gateEvidence.afterPathEvidenceSha256,
      "lineage.gateEvidence.afterPathEvidenceSha256"
    );
    var reconciliationStatusSha256 = this._sha256(
      gateEvidence.reconciliationStatusSha256,
      "lineage.gateEvidence.reconciliationStatusSha256"
    );

    this._validateEmbeddedPreflight(evidence.preflight, {
      number: changeNumber,
      sysId: changeSysId,
      deploymentId: deploymentId,
      networkId: networkId,
      serviceEntityIds: serviceEntityIds,
    });
    this._validateEmbeddedGate(evidence.gate, {
      number: changeNumber,
      deploymentId: deploymentId,
      networkId: networkId,
      serviceEntityIds: serviceEntityIds,
      beforeSnapshotId: beforeSnapshotId,
      afterSnapshotId: afterSnapshotId,
      decision: decision,
      generatedAt: generatedAt,
      reasonCodes: reasonCodes,
      reconciliationRunId: reconciliationRunId,
      reconciliationState: reconciliationState,
      dynatraceDeploymentState: deploymentState,
      dynatraceServiceHealth: serviceHealth,
      dynatraceOpenProblemCount: openProblemCount,
      contextSha256: contextSha256,
      beforePathEvidenceSha256: beforePathEvidenceSha256,
      afterPathEvidenceSha256: afterPathEvidenceSha256,
      reconciliationStatusSha256: reconciliationStatusSha256,
    });
    this._validateEmbeddedHashes(evidence.preflight, evidence.gate, preflightSha256, gateSha256);

    return {
      schemaVersion: this.SCHEMA_VERSION,
      generatedAt: generatedAt,
      changeNumber: changeNumber,
      changeSysId: changeSysId,
      deploymentId: deploymentId,
      serviceEntityIds: serviceEntityIds,
      decision: decision,
      reasonCodes: reasonCodes,
      networkId: networkId,
      beforeSnapshotId: beforeSnapshotId,
      afterSnapshotId: afterSnapshotId,
      reconciliationRunId: reconciliationRunId,
      reconciliationState: reconciliationState,
      dynatraceDeploymentState: deploymentState,
      dynatraceServiceHealth: serviceHealth,
      dynatraceOpenProblemCount: openProblemCount,
      preflightSha256: preflightSha256,
      gateSha256: gateSha256,
    };
  },

  workNote: function (normalized, evidenceSha256, assuranceNumber) {
    var hash = this._sha256(evidenceSha256, "evidenceSha256");
    var marker = "[forward-dynatrace:" + hash + "]";
    return [
      "Forward/Dynatrace change assurance: " + String(normalized.decision || "").toUpperCase(),
      "Deployment: " + normalized.deploymentId,
      "Forward network/snapshots: " + normalized.networkId + " " + normalized.beforeSnapshotId + " -> " + normalized.afterSnapshotId,
      "Dynatrace: deployment=" + normalized.dynatraceDeploymentState + " health=" + normalized.dynatraceServiceHealth +
        " open_problems=" + normalized.dynatraceOpenProblemCount,
      "Reasons: " + normalized.reasonCodes.join(","),
      "Evidence SHA-256: " + hash,
      assuranceNumber ? "Assurance record: " + assuranceNumber : "",
      marker,
    ].filter(function (line) { return Boolean(line); }).join("\n");
  },

  _validateEmbeddedPreflight: function (preflight, expected) {
    var value = this._object(preflight, "preflight");
    this._assertKnownKeys(value, {
      schemaVersion: true,
      observedAt: true,
      mode: true,
      source: true,
      change: true,
      scope: true,
      authorization: true,
      nextStages: true,
    }, "embedded preflight");
    if (value.schemaVersion !== "forward-dynatrace-servicenow-change-preflight/v1") {
      throw new Error("embedded preflight schemaVersion is unsupported");
    }
    this._isoDateTime(value.observedAt, "embedded preflight observedAt");
    if (value.mode !== "read-only") throw new Error("embedded preflight mode must be read-only");

    var source = this._object(value.source, "embedded preflight source");
    this._assertKnownKeys(source, {
      instanceAlias: true,
      table: true,
      authoritativeRead: true,
    }, "embedded preflight source");
    this._requiredString(source.instanceAlias, "embedded preflight source instanceAlias", 128);
    if (source.table !== "change_request" || source.authoritativeRead !== true) {
      throw new Error("embedded preflight source is not an authoritative change_request read");
    }

    var change = this._object(value.change, "embedded preflight change");
    this._assertKnownKeys(change, {
      number: true,
      sysId: true,
      deploymentId: true,
      approval: true,
      state: true,
      risk: true,
      assignmentGroup: true,
      window: true,
    }, "embedded preflight change");
    if (change.number !== expected.number || change.sysId !== expected.sysId ||
        change.deploymentId !== expected.deploymentId) {
      throw new Error("embedded preflight change identity does not match evidence");
    }
    this._valueDisplay(change.approval, "embedded preflight approval");
    this._valueDisplay(change.state, "embedded preflight state");
    this._valueDisplay(change.risk, "embedded preflight risk");
    this._valueDisplay(change.assignmentGroup, "embedded preflight assignmentGroup");
    var window = this._object(change.window, "embedded preflight window");
    this._assertKnownKeys(window, { startsAt: true, endsAt: true }, "embedded preflight window");
    this._nullableIsoDateTime(window.startsAt, "embedded preflight window startsAt");
    this._nullableIsoDateTime(window.endsAt, "embedded preflight window endsAt");

    var scope = this._object(value.scope, "embedded preflight scope");
    this._assertKnownKeys(scope, {
      forwardNetworkId: true,
      serviceEntityIds: true,
    }, "embedded preflight scope");
    if (String(scope.forwardNetworkId || "") !== expected.networkId) {
      throw new Error("embedded preflight network does not match evidence");
    }
    var authorization = this._object(value.authorization, "embedded preflight authorization");
    this._assertKnownKeys(authorization, {
      status: true,
      reasons: true,
      eligibleStateValues: true,
      approvedValues: true,
    }, "embedded preflight authorization");
    if (authorization.status !== "eligible") {
      throw new Error("embedded preflight must be eligible");
    }
    if (!Array.isArray(authorization.reasons) || authorization.reasons.length > 100) {
      throw new Error("embedded preflight authorization reasons must be a bounded array");
    }
    for (var r = 0; r < authorization.reasons.length; r++) {
      var reason = this._object(authorization.reasons[r], "embedded preflight authorization reason");
      this._assertKnownKeys(reason, { code: true, message: true }, "embedded preflight authorization reason");
      this._requiredString(reason.code, "embedded preflight authorization reason code", 128);
      this._requiredString(reason.message, "embedded preflight authorization reason message", 1000);
    }
    this._stringArray(authorization.eligibleStateValues, "embedded preflight eligibleStateValues", 100, 128);
    this._stringArray(authorization.approvedValues, "embedded preflight approvedValues", 100, 128);
    var nextStages = this._stringArray(value.nextStages, "embedded preflight nextStages", 8, 64);
    var allowedStages = {
      "dynatrace-baseline": true,
      "forward-before-evidence": true,
      "customer-deployment": true,
      "dynatrace-post-change-health": true,
      "forward-after-evidence": true,
      "forward-reconciliation-dry-run": true,
      "combined-change-gate": true,
      "servicenow-evidence-feedback": true,
    };
    for (var n = 0; n < nextStages.length; n++) {
      if (!allowedStages[nextStages[n]]) throw new Error("embedded preflight nextStages contains an unsupported stage");
    }
    this._sameStringSet(
      scope.serviceEntityIds,
      expected.serviceEntityIds,
      "embedded preflight service scope",
      100,
      255,
      4000
    );
  },

  _validateEmbeddedGate: function (gate, expected) {
    var value = this._object(gate, "gate");
    this._assertKnownKeys(value, {
      schemaVersion: true,
      generatedAt: true,
      change: true,
      decision: true,
      reasons: true,
      dynatrace: true,
      forward: true,
      evidence: true,
    }, "embedded gate");
    if (value.schemaVersion !== "forward-dynatrace-change-validation/v1") {
      throw new Error("embedded gate schemaVersion is unsupported");
    }
    if (value.generatedAt !== expected.generatedAt) {
      throw new Error("embedded gate generatedAt does not match evidence");
    }
    var change = this._object(value.change, "embedded gate change");
    this._assertKnownKeys(change, {
      changeId: true,
      deploymentId: true,
      serviceEntityIds: true,
    }, "embedded gate change");
    if (change.changeId !== expected.number || change.deploymentId !== expected.deploymentId) {
      throw new Error("embedded gate change identity does not match evidence");
    }
    if (String(value.decision || "").toLowerCase() !== expected.decision) {
      throw new Error("embedded gate decision does not match evidence");
    }
    var forward = this._object(value.forward, "embedded gate forward");
    this._assertKnownKeys(forward, {
      networkId: true,
      before: true,
      after: true,
      delta: true,
      reconciliation: true,
    }, "embedded gate forward");
    if (String(forward.networkId || "") !== expected.networkId ||
        String(this._object(forward.before, "embedded gate before").snapshotId || "") !== expected.beforeSnapshotId ||
        String(this._object(forward.after, "embedded gate after").snapshotId || "") !== expected.afterSnapshotId) {
      throw new Error("embedded gate Forward target does not match evidence");
    }
    this._sameStringSet(
      change.serviceEntityIds,
      expected.serviceEntityIds,
      "embedded gate service scope",
      100,
      255,
      4000
    );

    if (!Array.isArray(value.reasons) || !value.reasons.length) {
      throw new Error("embedded gate reasons must be a non-empty array");
    }
    var gateReasonCodes = [];
    for (var i = 0; i < value.reasons.length; i++) {
      var gateReason = this._object(value.reasons[i], "embedded gate reason");
      this._assertKnownKeys(gateReason, {
        severity: true,
        code: true,
        message: true,
      }, "embedded gate reason");
      if (["info", "warn", "fail"].indexOf(gateReason.severity) < 0) {
        throw new Error("embedded gate reason severity is unsupported");
      }
      this._requiredString(gateReason.message, "embedded gate reason message", 1000);
      gateReasonCodes.push(this._requiredString(
        gateReason.code,
        "embedded gate reason code",
        128
      ));
    }
    this._sameStringSet(gateReasonCodes, expected.reasonCodes, "embedded gate reason codes", 100, 128, 4000);

    this._pathSummary(forward.before, "embedded gate before");
    this._pathSummary(forward.after, "embedded gate after");
    this._signedIntegerObject(
      forward.delta,
      ["reachable", "blocked", "ambiguous", "unmapped", "failed"],
      "embedded gate delta"
    );

    var reconciliation = this._object(forward.reconciliation, "embedded gate reconciliation");
    this._assertKnownKeys(reconciliation, {
      runId: true,
      packageId: true,
      importState: true,
      target: true,
      plannedChecks: true,
      counts: true,
      unresolvedCounts: true,
    }, "embedded gate reconciliation");
    if (this._optionalString(reconciliation.runId, "embedded gate reconciliation runId", 255) !==
          expected.reconciliationRunId ||
        this._optionalString(reconciliation.importState, "embedded gate reconciliation importState", 64) !==
          expected.reconciliationState) {
      throw new Error("embedded gate reconciliation does not match evidence");
    }

    this._optionalString(reconciliation.packageId, "embedded gate reconciliation packageId", 255);
    var target = this._object(reconciliation.target, "embedded gate reconciliation target");
    this._assertKnownKeys(target, { networkId: true, snapshotId: true }, "embedded gate reconciliation target");
    var targetNetworkId = this._optionalString(
      target.networkId,
      "embedded gate reconciliation target networkId",
      255
    );
    var targetSnapshotId = this._optionalString(
      target.snapshotId,
      "embedded gate reconciliation target snapshotId",
      255
    );
    if (targetNetworkId !== expected.networkId || targetSnapshotId !== expected.afterSnapshotId) {
      throw new Error("embedded gate reconciliation target does not match evidence");
    }
    this._nonnegativeInteger(reconciliation.plannedChecks, "embedded gate reconciliation plannedChecks");
    this._integerObject(
      reconciliation.counts,
      ["create", "unchanged", "changed", "stale"],
      "embedded gate reconciliation counts"
    );
    this._integerObject(
      reconciliation.unresolvedCounts,
      ["changed", "stale"],
      "embedded gate reconciliation unresolvedCounts"
    );

    var dynatrace = this._object(value.dynatrace, "embedded gate dynatrace");
    this._assertKnownKeys(dynatrace, {
      deploymentState: true,
      serviceHealth: true,
      openProblemCount: true,
    }, "embedded gate dynatrace");
    if (String(dynatrace.deploymentState || "") !== expected.dynatraceDeploymentState ||
        String(dynatrace.serviceHealth || "") !== expected.dynatraceServiceHealth ||
        String(dynatrace.openProblemCount) !== String(expected.dynatraceOpenProblemCount)) {
      throw new Error("embedded gate Dynatrace summary does not match evidence");
    }

    var embeddedEvidence = this._object(value.evidence, "embedded gate evidence");
    this._assertKnownKeys(embeddedEvidence, {
      contextSha256: true,
      beforePathEvidenceSha256: true,
      afterPathEvidenceSha256: true,
      reconciliationStatusSha256: true,
    }, "embedded gate evidence");
    if (String(embeddedEvidence.contextSha256 || "") !== expected.contextSha256 ||
        String(embeddedEvidence.beforePathEvidenceSha256 || "") !== expected.beforePathEvidenceSha256 ||
        String(embeddedEvidence.afterPathEvidenceSha256 || "") !== expected.afterPathEvidenceSha256 ||
        String(embeddedEvidence.reconciliationStatusSha256 || "") !== expected.reconciliationStatusSha256) {
      throw new Error("embedded gate evidence hashes do not match lineage");
    }
  },

  _validateEmbeddedHashes: function (preflight, gate, preflightSha256, gateSha256) {
    var actualPreflightSha256 = this._sha256Text(preflight);
    if (actualPreflightSha256 !== preflightSha256) {
      throw new Error(
        "embedded preflight SHA-256 does not match lineage (expected " +
        preflightSha256 + ", computed " + actualPreflightSha256 + ")"
      );
    }
    var actualGateSha256 = this._sha256Text(gate);
    if (actualGateSha256 !== gateSha256) {
      throw new Error(
        "embedded gate SHA-256 does not match lineage (expected " +
        gateSha256 + ", computed " + actualGateSha256 + ")"
      );
    }
  },

  _sha256Text: function (value) {
    if (typeof GlideDigest === "undefined") throw new Error("SHA-256 validation is unavailable");
    // Hash compact sorted JSON so the digest does not depend on differences in
    // pretty-print support between ServiceNow's Rhino runtime and Node.js.
    return String(new GlideDigest().getSHA256Hex(JSON.stringify(this._sortForHash(value)))).toLowerCase();
  },

  _sortForHash: function (value) {
    if (Array.isArray(value)) {
      var items = [];
      for (var i = 0; i < value.length; i++) items.push(this._sortForHash(value[i]));
      return items;
    }
    if (!this._isObject(value)) return value;
    var keys = [];
    for (var key in value) {
      if (value.hasOwnProperty(key)) keys.push(key);
    }
    keys.sort();
    var sorted = {};
    for (var j = 0; j < keys.length; j++) {
      sorted[keys[j]] = this._sortForHash(value[keys[j]]);
    }
    return sorted;
  },

  _rejectUnsafeContent: function (value, depth) {
    if (depth > 24) throw new Error("assurance evidence nesting is too deep");
    if (typeof value === "string") {
      if (/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+\/-]+=*/i.test(value) ||
          /dt0[a-z0-9]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/i.test(value)) {
        throw new Error("assurance evidence contains credential-shaped content");
      }
      return;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) this._rejectUnsafeContent(value[i], depth + 1);
      return;
    }
    if (!this._isObject(value)) return;
    var forbidden = {
      password: true,
      secret: true,
      token: true,
      credentials: true,
      authorizationheader: true,
      rows: true,
      hops: true,
      devices: true,
      rawresponse: true,
      sourceresolvedvalue: true,
      destinationresolvedvalue: true,
    };
    for (var key in value) {
      if (!value.hasOwnProperty(key)) continue;
      var normalizedKey = String(key).toLowerCase().replace(/[_-]/g, "");
      if (forbidden[normalizedKey]) throw new Error("assurance evidence contains forbidden field: " + key);
      this._rejectUnsafeContent(value[key], depth + 1);
    }
  },

  _sameStringSet: function (actual, expected, label, maxItems, maxItemLength, maxJoinedLength) {
    var left = this._stringArray(actual, label, maxItems, maxItemLength, maxJoinedLength).slice().sort();
    var right = expected.slice().sort();
    if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(label + " does not match evidence");
  },

  _assertKnownKeys: function (value, allowed, label) {
    for (var key in value) {
      if (value.hasOwnProperty(key) && !allowed[key]) throw new Error(label + " contains unsupported field: " + key);
    }
  },

  _valueDisplay: function (value, label) {
    var item = this._object(value, label);
    this._assertKnownKeys(item, { value: true, display: true }, label);
    if (typeof item.value !== "string" || typeof item.display !== "string") {
      throw new Error(label + " value and display must be strings");
    }
  },

  _pathSummary: function (value, label) {
    var item = this._object(value, label);
    this._assertKnownKeys(item, {
      snapshotId: true,
      status: true,
      assessment: true,
      counts: true,
    }, label);
    this._optionalString(item.snapshotId, label + " snapshotId", 255);
    this._optionalString(item.status, label + " status", 64);
    this._optionalString(item.assessment, label + " assessment", 255);
    this._integerObject(
      item.counts,
      ["total", "queryable", "reachable", "blocked", "ambiguous", "unmapped", "failed"],
      label + " counts"
    );
  },

  _integerObject: function (value, keys, label) {
    var item = this._object(value, label);
    var allowed = {};
    for (var i = 0; i < keys.length; i++) allowed[keys[i]] = true;
    this._assertKnownKeys(item, allowed, label);
    for (var j = 0; j < keys.length; j++) {
      this._nonnegativeInteger(item[keys[j]], label + " " + keys[j]);
    }
  },

  _signedIntegerObject: function (value, keys, label) {
    var item = this._object(value, label);
    var allowed = {};
    for (var i = 0; i < keys.length; i++) allowed[keys[i]] = true;
    this._assertKnownKeys(item, allowed, label);
    for (var j = 0; j < keys.length; j++) {
      var candidate = item[keys[j]];
      if (typeof candidate !== "number" || !isFinite(candidate) || Math.floor(candidate) !== candidate ||
          candidate < -2147483648 || candidate > 2147483647) {
        throw new Error(label + " " + keys[j] + " must be a signed integer");
      }
    }
  },

  _nonnegativeInteger: function (value, label) {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value ||
        value < 0 || value > 2147483647) {
      throw new Error(label + " must be a non-negative integer");
    }
    return value;
  },

  _object: function (value, label) {
    if (!this._isObject(value)) throw new Error(label + " must be an object");
    return value;
  },

  _isObject: function (value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  },

  _requiredString: function (value, label, maxLength) {
    var text = typeof value === "string" ? value.replace(/^\s+|\s+$/g, "") : "";
    if (!text) throw new Error(label + " must be a non-empty string");
    if (maxLength && text.length > maxLength) throw new Error(label + " exceeds " + maxLength + " characters");
    return text;
  },

  _optionalString: function (value, label, maxLength) {
    var text = value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
    if (maxLength && text.length > maxLength) throw new Error(label + " exceeds " + maxLength + " characters");
    return text;
  },

  _stringArray: function (value, label, maxItems, maxItemLength, maxJoinedLength) {
    if (!Array.isArray(value) || !value.length || (maxItems && value.length > maxItems)) {
      throw new Error(
        maxItems ? label + " must contain between 1 and " + maxItems + " values" : label + " must be a non-empty array"
      );
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < value.length; i++) {
      var item = this._requiredString(value[i], label + " item", maxItemLength);
      if (seen[item]) throw new Error(label + " must contain unique values");
      seen[item] = true;
      out.push(item);
    }
    if (maxJoinedLength && out.join(",").length > maxJoinedLength) {
      throw new Error(label + " exceeds the persisted field bound");
    }
    return out;
  },

  _utf8ByteLength: function (value) {
    var text = String(value || "");
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
          text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  },

  _enum: function (value, allowed, label) {
    var text = this._requiredString(value, label);
    if (allowed.indexOf(text) < 0) throw new Error(label + " is unsupported");
    return text;
  },

  _sha256: function (value, label) {
    var text = this._requiredString(value, label);
    if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(label + " must be a lowercase SHA-256 value");
    return text;
  },

  _isoDateTime: function (value, label) {
    var text = this._requiredString(value, label);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) || isNaN(Date.parse(text))) {
      throw new Error(label + " must be an ISO UTC date-time");
    }
    return text;
  },

  _nullableIsoDateTime: function (value, label) {
    if (value == null) return "";
    return this._isoDateTime(value, label);
  },

  type: "ChangeAssuranceContract",
};

if (typeof module !== "undefined" && module.exports) module.exports = ChangeAssuranceContract;
