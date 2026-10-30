var ForwardPathCheck = Class.create();
ForwardPathCheck.prototype = {
  initialize: function (client) {
    this._client = client || null;
  },

  // Runs one Forward path search for a validation record and writes the verdict back to it.
  // Configuration problems throw. Forward API failures are recorded on the record as "error".
  // pinnedSnapshotId is optional. The record's forward_snapshot_id is output only: it says which snapshot the
  // last run searched, and is never read back as a pin, so a re-run after a change searches the newest one.
  run: function (validationSysId, pinnedSnapshotId) {
    // Record ACLs only protect the record when the caller is a real user; a System run would bypass them.
    if (String(gs.getUserName()) === "system") throw new Error("run this action as a user, not as System");
    var id = String(validationSysId || "");
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("validation record sys_id is invalid");
    var record = new GlideRecordSecure("__SCOPE___validation");
    if (!record.get(id)) throw new Error("validation record was not found");
    if (!record.canWrite()) throw new Error("not permitted to update this validation record");

    var client = this._client || new ForwardApiClient();
    var outcome;
    try {
      outcome = this._check(client, record, String(pinnedSnapshotId || ""));
    } catch (e) {
      if (!e || !e.kind) throw e;
      // A bad input is the record's fault, not Forward's, so it is not reported as a Forward error.
      outcome = { status: "error", observed: "", snapshotId: "",
        note: e.kind === "invalid_request" ? "Invalid input: " + e.message
          : "Forward API error: " + e.kind + (e.status ? " (" + e.status + ")" : "") };
    }
    record.setValue("validation_status", outcome.status);
    record.setValue("observed_outcome", outcome.observed);
    // Output only: always the snapshot this run searched, blank when it searched none.
    record.setValue("forward_snapshot_id", outcome.snapshotId);
    record.setValue("evidence_summary", String(outcome.note).substring(0, 4000));
    // GlideRecordSecure returns no sys_id when an ACL or business rule stops the write; never report an unsaved verdict.
    if (!record.update()) throw new Error("the validation result could not be saved");
    return { status: outcome.status, observedOutcome: outcome.observed, snapshotId: outcome.snapshotId };
  },

  _check: function (client, record, pinnedSnapshotId) {
    var networkId = String(record.getValue("forward_network_id") || "");
    if (!networkId) return { status: "error", observed: "", snapshotId: "", note: "Forward network ID is required" };

    // The snapshot used is always recorded: when none is pinned, the latest processed one is chosen here
    // rather than left to the server, so the record says exactly what was searched.
    var snapshotId = pinnedSnapshotId;
    if (!snapshotId) {
      snapshotId = this.latestProcessedSnapshot(client.listSnapshots(networkId));
      if (!snapshotId) return { status: "error", observed: "", snapshotId: "", note: "No processed Forward snapshot exists for this network" };
    }

    var args = {
      networkId: networkId,
      srcIp: String(record.getValue("source_ip") || ""),
      dstIp: String(record.getValue("destination_ip") || ""),
      snapshotId: snapshotId,
    };
    var protocol = String(record.getValue("protocol") || "");
    if (protocol === "TCP") args.ipProto = 6;
    else if (protocol === "UDP") args.ipProto = 17;
    var port = String(record.getValue("destination_port") || "");
    if (port && port !== "0") args.dstPort = port;

    var verdict = this.evaluate(client.pathSearch(args), String(record.getValue("expected_outcome") || ""));
    verdict.snapshotId = snapshotId;
    return verdict;
  },

  // Forward's own rule for "latest": the newest processed snapshot by creation time, not by when processing
  // finished. Drafts, forks and predictions are never chosen. Timestamps are ISO-8601 in UTC and sort as text.
  latestProcessedSnapshot: function (snapshots) {
    var best = null;
    for (var i = 0; i < snapshots.length; i++) {
      var item = snapshots[i];
      if (item.state !== "PROCESSED" || item.isDraft || item.parentSnapshotId) continue;
      if (item.processingTrigger === "PREDICT" || item.processingTrigger === "FORK") continue;
      var created = item.createdAt || "";
      var processed = item.processedAt || "";
      if (!best || created > best.created || (created === best.created && processed > best.processed)) {
        best = { id: item.id, created: created, processed: processed };
      }
    }
    return best ? best.id : "";
  },

  // Turns a path summary into a verdict. Without evidence it reports an error, never a guess.
  evaluate: function (summary, expected) {
    if (summary.timedOut) return { status: "error", observed: "", note: "Forward path search timed out" };
    if (!summary.pathCount) return { status: "error", observed: "", note: "Forward returned no paths for this flow" };

    var allowed = false;
    var incomplete = false;
    for (var i = 0; i < summary.paths.length; i++) {
      if (summary.paths[i].forwardingOutcome === "DELIVERED" && summary.paths[i].securityOutcome === "PERMITTED") allowed = true;
      if (!summary.paths[i].forwardingOutcome || !summary.paths[i].securityOutcome) incomplete = true;
    }
    if (!allowed) {
      // "blocked" claims that no path gets through, so it needs every path seen and every outcome stated.
      // Forward's LOWER_BOUND means more paths may exist beyond the ones returned.
      var hits = summary.totalHits;
      var exact = hits && hits.type === "EXACT" && hits.value === summary.pathCount && summary.pathCount === summary.paths.length;
      if (incomplete || !exact) {
        return { status: "error", observed: "", note: "Forward's result was incomplete (cut off or missing outcomes); no verdict was recorded" };
      }
    }

    var observed = allowed ? "allowed" : "blocked";
    var devices = [];
    for (var j = 0; j < summary.paths.length; j++) {
      for (var k = 0; k < summary.paths[j].devices.length && devices.length < 10; k++) {
        if (devices.indexOf(summary.paths[j].devices[k]) < 0) devices.push(summary.paths[j].devices[k]);
      }
    }
    var note = "Observed " + observed + " across " + summary.paths.length + " path(s). Forwarding: " +
      summary.forwardingOutcomes.join(", ") + ". Security: " + summary.securityOutcomes.join(", ") + "." +
      (devices.length ? " Devices: " + devices.join(", ") + "." : "");

    if (!expected) return { status: "not_run", observed: observed, note: note + " No expected outcome was set." };
    return { status: observed === expected ? "pass" : "fail", observed: observed, note: note };
  },

  type: "ForwardPathCheck",
};

if (typeof module !== "undefined" && module.exports) module.exports = ForwardPathCheck;
