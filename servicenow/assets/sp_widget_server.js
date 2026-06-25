(function () {
  data.networks = [];
  data.snapshots = [];
  data.cis = [];
  data.status = {};

  function isValidTable(name) {
    try {
      var gr = new GlideRecord(String(name || ""));
      return gr && gr.isValid();
    } catch (e) {
      return false;
    }
  }

  function tableFromProperty(propName, defaultTable, fallbackTable) {
    var t = String(gs.getProperty(propName, defaultTable) || "");
    if (t && isValidTable(t)) return t;
    if (fallbackTable && isValidTable(fallbackTable)) return String(fallbackTable);
    return String(defaultTable);
  }

  function ticketTable() {
    return tableFromProperty(
      "x_fwd_demo.tables.ticket",
      "u_forward_connectivity_ticket",
      "x_fwd_demo_connectivity_ticket"
    );
  }

  function hopTable() {
    return tableFromProperty(
      "x_fwd_demo.tables.hop",
      "u_forward_connectivity_hop",
      "x_fwd_demo_connectivity_hop"
    );
  }

  function changeValidationTable() {
    return tableFromProperty(
      "x_fwd_demo.tables.change_validation",
      "u_forward_change_validation",
      "x_fwd_demo_change_validation"
    );
  }

  function ciTable() {
    return tableFromProperty("x_fwd_demo.cmdb.ci_table", "cmdb_ci_netgear", "cmdb_ci");
  }

  function hasField(gr, field) {
    try {
      return gr && gr.isValidField && gr.isValidField(field);
    } catch (e) {
      return false;
    }
  }

  function setIfValid(gr, field, value) {
    if (!hasField(gr, field)) return;
    gr.setValue(field, value == null ? "" : value);
  }

  function getValue(gr, field) {
    try {
      if (!hasField(gr, field)) return "";
      return String(gr.getValue(field) || "");
    } catch (e) {
      return "";
    }
  }

  function getDisplay(gr, field) {
    try {
      if (!hasField(gr, field)) return "";
      return String(gr.getDisplayValue(field) || getValue(gr, field) || "");
    } catch (e) {
      return "";
    }
  }

  function resolveTenantUsernameOverride(raw) {
    var tenantUsername = String(raw || "").replace(/^\s+|\s+$/g, "");
    if (!tenantUsername) return "";
    try {
      if (gs.hasRole("admin")) return tenantUsername;
    } catch (e) {}
    return "";
  }

  function forwardClient(overrideTenantUsername) {
    var tenantUsername = resolveTenantUsernameOverride(overrideTenantUsername);
    return tenantUsername ? new ForwardClient({ tenantUsername: tenantUsername }) : new ForwardClient();
  }

  function currentTenantUsername(overrideTenantUsername) {
    try {
      return String(forwardClient(overrideTenantUsername).getTenantUsername() || "");
    } catch (e) {
      return "";
    }
  }

  function ticketBelongsToCurrentTenant(ticket, overrideTenantUsername) {
    var tenantUsername = currentTenantUsername(overrideTenantUsername);
    if (!tenantUsername) return false;
    return String(getValue(ticket, "u_forward_tenant_username")) === tenantUsername;
  }

  function bad(msg) {
    data.error = msg;
    return;
  }

  function param(name) {
    try {
      if (typeof input !== "undefined" && input && input[name] != null) return String(input[name] || "");
    } catch (e) {}
    try {
      if (typeof options !== "undefined" && options && options[name] != null) return String(options[name] || "");
    } catch (e) {}
    try {
      if (typeof $sp !== "undefined" && $sp && $sp.getParameter) return String($sp.getParameter(name) || "");
    } catch (e) {}
    return "";
  }

  function toBool(v) {
    return String(v) === "true" || String(v) === "1";
  }

  function recommendedTeam(category) {
    var c = String(category || "").toLowerCase();
    if (c === "security") return "security";
    if (c === "analysis_error") return "triage";
    return "network";
  }

  function evidenceSummary(form, ticket) {
    var parts = [];
    parts.push("Forward path analysis for " + String(form.srcIp || "") + " -> " + String(form.dstIp || ""));
    if (form.protocol) parts.push("Protocol: " + String(form.protocol));
    if (form.dstPort) parts.push("Destination port: " + String(form.dstPort));
    parts.push("Verdict: " + (ticket.u_allowed ? "ALLOWED" : "BLOCKED"));
    if (!ticket.u_allowed) {
      parts.push("Category: " + String(ticket.u_block_category || "unknown"));
      parts.push("Reason: " + String(ticket.u_block_reason || ""));
      if (ticket.u_block_device) parts.push("Blocked at: " + ticket.u_block_device + " " + String(ticket.u_block_interface || ""));
    }
    return parts.join("\n");
  }

  function changeValidationSummary(form, ticket, expectedOutcome, status) {
    var parts = [];
    parts.push("Forward change validation: " + String(status || "").toUpperCase());
    if (expectedOutcome) parts.push("Expected: " + String(expectedOutcome).toUpperCase());
    parts.push(evidenceSummary(form, ticket));
    if (ticket.u_forward_query_url) parts.push("Forward evidence: " + ticket.u_forward_query_url);
    return parts.join("\n");
  }

  function serializeTicket(t) {
    var allowed = toBool(getValue(t, "u_allowed"));
    var category = getValue(t, "u_block_category");
    return {
      sys_id: String(t.sys_id),
      number: String(t.number || ""),
      u_forward_tenant_username: getValue(t, "u_forward_tenant_username"),
      u_analysis_status: getValue(t, "u_analysis_status"),
      u_analysis_error: getValue(t, "u_analysis_error"),
      u_allowed: allowed,
      u_block_category: category,
      u_block_device: getValue(t, "u_block_device"),
      u_block_interface: getValue(t, "u_block_interface"),
      u_block_rule: getValue(t, "u_block_rule"),
      u_block_reason: getValue(t, "u_block_reason"),
      u_forward_query_url: getValue(t, "u_forward_query_url"),
      u_raw_excerpt: getValue(t, "u_raw_excerpt"),
      u_recommended_team: getValue(t, "u_recommended_team") || recommendedTeam(category),
      u_forward_evidence_summary: getValue(t, "u_forward_evidence_summary"),
      u_source_ci: getValue(t, "u_source_ci"),
      u_source_ci_display: getDisplay(t, "u_source_ci"),
      u_destination_ci: getValue(t, "u_destination_ci"),
      u_destination_ci_display: getDisplay(t, "u_destination_ci"),
      u_incident: getValue(t, "u_incident"),
      u_incident_number: getValue(t, "u_incident_number"),
      assignment_group: getValue(t, "assignment_group"),
    };
  }

  function serializeHop(h) {
    return {
      sys_id: String(h.sys_id),
      u_hop_index: parseInt(getValue(h, "u_hop_index"), 10) || 0,
      u_device: getValue(h, "u_device"),
      u_ingress: getValue(h, "u_ingress"),
      u_egress: getValue(h, "u_egress"),
      u_note: getValue(h, "u_note"),
    };
  }

  function serializeCi(ci) {
    return {
      sys_id: String(ci.sys_id),
      name: getDisplay(ci, "name") || getValue(ci, "name"),
      ip_address: getValue(ci, "ip_address"),
      serial_number: getValue(ci, "serial_number"),
      model_id: getDisplay(ci, "model_id"),
      manufacturer: getDisplay(ci, "manufacturer"),
      location: getDisplay(ci, "location"),
      discovery_source: getValue(ci, "discovery_source"),
    };
  }

  function listCis() {
    var table = ciTable();
    var gr = new GlideRecord(table);
    var limit = parseInt(String(gs.getProperty("x_fwd_demo.cmdb.max_cis", "100")), 10) || 100;
    if (hasField(gr, "name")) gr.addNotNullQuery("name");
    if (hasField(gr, "ip_address")) gr.orderBy("ip_address");
    else if (hasField(gr, "name")) gr.orderBy("name");
    gr.setLimit(limit);
    gr.query();
    var out = [];
    while (gr.next()) {
      var row = serializeCi(gr);
      if (row.name || row.ip_address) out.push(row);
    }
    return out;
  }

  function getCi(sysId) {
    var id = String(sysId || "");
    if (!id) return null;
    var gr = new GlideRecord(ciTable());
    if (!gr.get(id)) return null;
    return serializeCi(gr);
  }

  function validateForm(form) {
    form = form || {};
    if (!form.networkId) return "network is required";
    if (!/^\d+$/.test(String(form.networkId))) return "network id must be numeric";
    if (!form.srcIp) return "source IP is required";
    if (!form.dstIp) return "destination IP is required";
    if (form.dstPort) {
      var port = parseInt(String(form.dstPort), 10);
      if (!port || port < 1 || port > 65535) return "destination port must be 1-65535";
    }
    return "";
  }

  function chooseSnapshotID(networkId, requestedSnapshotID, overrideTenantUsername) {
    var req = String(requestedSnapshotID || "");
    if (req) return req;
    var list = forwardClient(overrideTenantUsername).listSnapshots(String(networkId || ""));
    if (!Array.isArray(list) || !list.length) return "";
    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {};
      if (String(s.status || "").toLowerCase() === "processed") return String(s.id || "");
    }
    return String((list[0] || {}).id || "");
  }

  function isTicketWorthyCategory(category) {
    var c = String(category || "").toLowerCase();
    return c === "security" || c === "blackhole" || c === "reachability" || c === "unknown";
  }

  function excerptRaw(raw) {
    try {
      var s = JSON.stringify(raw || {});
      if (s.length > 3500) return s.substring(0, 3500) + "...";
      return s;
    } catch (e) {
      return "";
    }
  }

  function normalizeHops(hops) {
    var out = [];
    var list = Array.isArray(hops) ? hops : [];
    for (var i = 0; i < list.length; i++) {
      var h = list[i] || {};
      out.push({
        hop_index: i + 1,
        device: String(h.deviceName || h.device || ""),
        ingress: String(h.ingressInterface || h.inIntf || h.ingress || ""),
        egress: String(h.egressInterface || h.outIntf || h.egress || ""),
        note: String(h.note || ""),
      });
    }
    return out;
  }

  function classifyBlock(pathObj) {
    var hops = Array.isArray(pathObj && pathObj.hops) ? pathObj.hops : [];
    var forwardingOutcome = String((pathObj && pathObj.forwardingOutcome) || "").toUpperCase();
    var securityOutcome = String((pathObj && pathObj.securityOutcome) || "").toUpperCase();
    var lastHop = hops.length ? hops[hops.length - 1] : {};
    var lastDevice = String((lastHop && (lastHop.deviceName || lastHop.device)) || "");
    var lastIface = String((lastHop && (lastHop.egressInterface || lastHop.outIntf || lastHop.ingressInterface || lastHop.inIntf)) || "");

    if (
      forwardingOutcome.indexOf("BLACKHOLE") >= 0 ||
      forwardingOutcome.indexOf("DROP") >= 0 ||
      forwardingOutcome.indexOf("DISCARD") >= 0 ||
      forwardingOutcome.indexOf("UNREACH") >= 0 ||
      forwardingOutcome.indexOf("NO_ROUTE") >= 0
    ) {
      return {
        category: "blackhole",
        reason: "Blackhole/drop detected. Route to Network.",
        device: lastDevice,
        iface: lastIface,
        rule: "",
      };
    }

    if (securityOutcome && securityOutcome !== "PERMITTED") {
      return {
        category: "security",
        reason: "Security policy blocked traffic. Route to Security.",
        device: lastDevice,
        iface: lastIface,
        rule: "",
      };
    }

    var list = Array.isArray(hops) ? hops : [];
    for (var i = 0; i < list.length; i++) {
      var h = list[i] || {};
      var note = String(h.note || "").toLowerCase();
      var disp = String(h.disposition || "").toLowerCase();
      var nf = h.networkFunctions || {};
      var acl = Array.isArray(nf.acl) ? nf.acl : [];
      for (var j = 0; j < acl.length; j++) {
        var a = acl[j] || {};
        var action = String(a.action || "").toUpperCase();
        if (action && action !== "PERMIT") {
          return {
            category: "security",
            reason: "ACL block detected. Route to Security.",
            device: String(h.deviceName || h.device || ""),
            iface: String(h.egressInterface || h.outIntf || h.ingressInterface || h.inIntf || ""),
            rule: String(a.name || h.ruleName || h.rule || ""),
          };
        }
      }
      if (disp.indexOf("deny") >= 0 || disp.indexOf("drop") >= 0 || note.indexOf("acl") >= 0 || note.indexOf("policy") >= 0) {
        return {
          category: "security",
          reason: "Security policy blocked traffic. Route to Security.",
          device: String(h.deviceName || h.device || ""),
          iface: String(h.egressInterface || h.outIntf || h.ingressInterface || h.inIntf || ""),
          rule: String(h.ruleName || h.rule || ""),
        };
      }
      if (disp.indexOf("blackhole") >= 0 || note.indexOf("blackhole") >= 0 || note.indexOf("null0") >= 0) {
        return {
          category: "blackhole",
          reason: "Blackhole/drop detected. Route to Network.",
          device: String(h.deviceName || h.device || ""),
          iface: String(h.egressInterface || h.outIntf || h.ingressInterface || h.inIntf || ""),
          rule: String(h.ruleName || h.rule || ""),
        };
      }
    }
    return {
      category: "reachability",
      reason: "Traffic not allowed. Route to Network.",
      device: "",
      iface: "",
      rule: "",
    };
  }

  function normalizePathSearch(raw) {
    raw = raw || {};
    var result = {
      allowed: false,
      block_category: "unknown",
      block_device: "",
      block_interface: "",
      block_rule: "",
      block_reason: "",
      query_url: "",
      raw_excerpt: excerptRaw(raw),
      hops: [],
    };
    if (raw.queryUrl) result.query_url = String(raw.queryUrl);
    if (!result.query_url && raw.query && raw.query.url) result.query_url = String(raw.query.url);
    var paths = [];
    if (raw.info && Array.isArray(raw.info.paths)) paths = raw.info.paths;
    else if (Array.isArray(raw.paths)) paths = raw.paths;
    if (!paths.length) {
      result.block_reason = "No paths returned";
      result.block_category = "reachability";
      return result;
    }
    var p = paths[0] || {};
    for (var pi = 0; pi < paths.length; pi++) {
      var cand = paths[pi] || {};
      var candSec = String(cand.securityOutcome || "").toUpperCase();
      var candFwd = String(cand.forwardingOutcome || "").toUpperCase();
      if (candSec === "DENIED") {
        p = cand;
        break;
      }
      if (candFwd && candFwd !== "DELIVERED" && candFwd !== "DELIVERED_TO_INCORRECT_LOCATION") p = cand;
    }
    var hops = Array.isArray(p.hops) ? p.hops : [];
    result.hops = normalizeHops(hops);
    var forwardingOutcome = String(p.forwardingOutcome || "").toUpperCase();
    var securityOutcome = String(p.securityOutcome || "").toUpperCase();
    if (forwardingOutcome) {
      result.allowed = forwardingOutcome === "DELIVERED" && securityOutcome !== "DENIED";
    } else {
      result.allowed = Boolean(p.isAllowed || p.allowed || securityOutcome === "PERMITTED");
    }
    if (result.allowed) {
      result.block_reason = "Allowed";
      return result;
    }
    var block = classifyBlock(p);
    result.block_category = block.category || "unknown";
    result.block_device = block.device || "";
    result.block_interface = block.iface || "";
    result.block_rule = block.rule || "";
    result.block_reason = block.reason || "Blocked";
    for (var hi = 0; hi < result.hops.length; hi++) {
      var rh = result.hops[hi] || {};
      if (rh.device === result.block_device && !rh.note) rh.note = result.block_reason;
    }
    return result;
  }

  function analyzeFromForm(form) {
    form = form || {};
    var sourceCI = getCi(form.sourceCiSysId);
    var destinationCI = getCi(form.destinationCiSysId);
    if (!form.srcIp && sourceCI && sourceCI.ip_address) form.srcIp = sourceCI.ip_address;
    if (!form.dstIp && destinationCI && destinationCI.ip_address) form.dstIp = destinationCI.ip_address;

    var err = validateForm(form);
    if (err) throw new Error(err);

    var norm;
    var resolvedTenantUsername = "";
    try {
      var client = forwardClient(form.forwardTenantUsername || form.tenantUsername || "");
      resolvedTenantUsername = client.getTenantUsername();
      var snapshotID = chooseSnapshotID(form.networkId, form.snapshotId, client.getTenantUsername());
      if (!snapshotID) throw new Error("no snapshots available for selected network");
      var raw = client.pathSearch({
        networkId: String(form.networkId),
        snapshotId: snapshotID,
        srcIp: String(form.srcIp),
        dstIp: String(form.dstIp),
        protocol: form.protocol ? String(form.protocol) : "",
        dstPort: form.dstPort ? String(form.dstPort) : "",
      });
      norm = normalizePathSearch(raw);
    } catch (e) {
      norm = {
        allowed: false,
        block_category: "analysis_error",
        block_device: "",
        block_interface: "",
        block_rule: "",
        block_reason: e && e.message ? String(e.message) : "Path analysis failed",
        query_url: "",
        raw_excerpt: "",
        hops: [],
      };
    }

    var ticket = {
      sys_id: "",
      number: "",
      u_forward_tenant_username: resolvedTenantUsername,
      u_analysis_status: norm.block_category === "analysis_error" ? "error" : "complete",
      u_analysis_error: norm.block_category === "analysis_error" ? String(norm.block_reason || "Path analysis failed") : "",
      u_allowed: toBool(norm.allowed),
      u_block_category: String(norm.block_category || ""),
      u_block_device: String(norm.block_device || ""),
      u_block_interface: String(norm.block_interface || ""),
      u_block_rule: String(norm.block_rule || ""),
      u_block_reason: String(norm.block_reason || ""),
      u_forward_query_url: String(norm.query_url || ""),
      u_raw_excerpt: String(norm.raw_excerpt || ""),
      u_recommended_team: recommendedTeam(norm.block_category),
      u_source_ci: sourceCI ? sourceCI.sys_id : "",
      u_source_ci_display: sourceCI ? sourceCI.name : "",
      u_destination_ci: destinationCI ? destinationCI.sys_id : "",
      u_destination_ci_display: destinationCI ? destinationCI.name : "",
      u_forward_evidence_summary: "",
      assignment_group: "",
    };
    ticket.u_forward_evidence_summary = evidenceSummary(form, ticket);

    return {
      ticket: ticket,
      hops: (norm.hops || []).map(function (h) {
        return {
          sys_id: "",
          u_hop_index: parseInt(String(h.hop_index || 0), 10) || 0,
          u_device: String(h.device || ""),
          u_ingress: String(h.ingress || ""),
          u_egress: String(h.egress || ""),
          u_note: String(h.note || ""),
        };
      }),
      recommendTicket: !toBool(norm.allowed) && (norm.block_category === "analysis_error" || isTicketWorthyCategory(norm.block_category)),
    };
  }

  function getGroupSysIdByName(name) {
    var gr = new GlideRecord("sys_user_group");
    gr.addQuery("name", name);
    gr.setLimit(1);
    gr.query();
    return gr.next() ? String(gr.sys_id) : "";
  }

  function groupForTeam(team) {
    var propName =
      team === "network"
        ? "x_fwd_demo.groups.network"
        : team === "security"
        ? "x_fwd_demo.groups.security"
        : "x_fwd_demo.groups.triage";
    var groupName = gs.getProperty(propName, "");
    return groupName ? getGroupSysIdByName(groupName) : "";
  }

  function changeRequestByNumber(number) {
    var raw = String(number || "").replace(/^\s+|\s+$/g, "");
    if (!raw) return null;
    if (!isValidTable("change_request")) throw new Error("change_request table is not available");

    var gr = new GlideRecord("change_request");
    gr.addQuery("number", raw);
    gr.setLimit(1);
    gr.query();
    if (!gr.next()) throw new Error("Change request not found: " + raw);
    return gr;
  }

  function validationStatus(ticket, expectedOutcome) {
    if (String(ticket.u_analysis_status || "") === "error") return "error";
    var expected = String(expectedOutcome || "").toLowerCase();
    if (expected === "allowed") return ticket.u_allowed ? "pass" : "fail";
    if (expected === "blocked") return !ticket.u_allowed ? "pass" : "fail";
    return "pass";
  }

  function createChangeValidation(form, expectedOutcome, changeNumber) {
    if (!isValidTable(changeValidationTable())) throw new Error("change validation table is not available");
    var analyzed = analyzeFromForm(form);
    var ticket = analyzed.ticket || {};
    var status = validationStatus(ticket, expectedOutcome);
    var summary = changeValidationSummary(form, ticket, expectedOutcome, status);
    var change = changeRequestByNumber(changeNumber);

    var rec = new GlideRecord(changeValidationTable());
    rec.initialize();
    rec.short_description = "Forward change validation: " + String(form.srcIp || "") + " -> " + String(form.dstIp || "");
    setIfValid(rec, "u_change_request", change ? change.sys_id : "");
    setIfValid(rec, "u_src_ip", form.srcIp || "");
    setIfValid(rec, "u_dst_ip", form.dstIp || "");
    setIfValid(rec, "u_protocol", form.protocol || "");
    setIfValid(rec, "u_dst_port", parseInt(form.dstPort, 10) || 0);
    setIfValid(rec, "u_forward_network_id", form.networkId || "");
    setIfValid(rec, "u_forward_snapshot_id", form.snapshotId || "");
    setIfValid(rec, "u_forward_tenant_username", ticket.u_forward_tenant_username || currentTenantUsername(form.tenantUsername || ""));
    setIfValid(rec, "u_expected_outcome", expectedOutcome || "");
    setIfValid(rec, "u_validation_status", status);
    setIfValid(rec, "u_allowed", toBool(ticket.u_allowed));
    setIfValid(rec, "u_block_category", ticket.u_block_category || "");
    setIfValid(rec, "u_block_device", ticket.u_block_device || "");
    setIfValid(rec, "u_block_interface", ticket.u_block_interface || "");
    setIfValid(rec, "u_block_rule", ticket.u_block_rule || "");
    setIfValid(rec, "u_block_reason", ticket.u_block_reason || "");
    setIfValid(rec, "u_forward_query_url", ticket.u_forward_query_url || "");
    setIfValid(rec, "u_forward_evidence_summary", summary);
    setIfValid(rec, "u_raw_excerpt", ticket.u_raw_excerpt || "");
    var validationSysId = rec.insert();

    if (change) {
      change.work_notes = summary + "\nValidation record: " + String(rec.number || validationSysId);
      change.update();
    }

    return {
      sys_id: String(validationSysId || ""),
      number: String(rec.number || ""),
      status: status,
      ticket: ticket,
      hops: analyzed.hops || [],
      summary: summary,
    };
  }

  function initStatus(overrideTenantUsername) {
    var status = {
      tenantUsername: "",
      bindingError: "",
      incidentTableReady: isValidTable("incident"),
      changeRequestTableReady: isValidTable("change_request"),
      changeValidationTableReady: isValidTable(changeValidationTable()),
      ciTable: ciTable(),
      ticketTable: ticketTable(),
      changeValidationTable: changeValidationTable(),
      defaultNetworkId: String(gs.getProperty("x_fwd_demo.forward.default_network_id", "") || ""),
    };
    try {
      var client = forwardClient(overrideTenantUsername);
      status.tenantUsername = client.getTenantUsername();
      data.networks = client.listNetworks();
    } catch (e) {
      status.bindingError = e && e.message ? String(e.message) : "Forward binding not ready";
      data.networks = [];
    }
    data.defaultNetworkId = status.defaultNetworkId;
    data.status = status;
  }

  try {
    var action = param("action");

    if (!action || action === "init") {
      initStatus(param("tenantUsername"));
      data.cis = listCis();
      return;
    }

    if (action === "snapshots") {
      var networkId = param("networkId");
      data.snapshots = forwardClient(param("tenantUsername")).listSnapshots(networkId);
      return;
    }

    if (action === "create") {
      var form = (input && input.form) || {};
      var previewTicket = (input && input.previewTicket) || null;
      var previewHops = (input && input.previewHops) || [];
      var createTenantUsername = currentTenantUsername((input && input.tenantUsername) || "");
      if (!createTenantUsername) return bad("tenant binding not found");
      var t = new GlideRecord(ticketTable());
      t.initialize();
      t.short_description = "Forward workflow: " + (form.srcIp || "") + " -> " + (form.dstIp || "");
      setIfValid(t, "u_src_ip", form.srcIp || "");
      setIfValid(t, "u_dst_ip", form.dstIp || "");
      setIfValid(t, "u_protocol", form.protocol || "");
      setIfValid(t, "u_dst_port", parseInt(form.dstPort, 10) || 0);
      setIfValid(t, "u_forward_network_id", form.networkId || "");
      setIfValid(t, "u_forward_snapshot_id", form.snapshotId || "");
      setIfValid(t, "u_forward_tenant_username", createTenantUsername);
      setIfValid(t, "u_source_ci", form.sourceCiSysId || "");
      setIfValid(t, "u_destination_ci", form.destinationCiSysId || "");
      if (previewTicket) {
        setIfValid(t, "u_analysis_status", String(previewTicket.u_analysis_status || "complete"));
        setIfValid(t, "u_analysis_error", String(previewTicket.u_analysis_error || ""));
        setIfValid(t, "u_allowed", toBool(previewTicket.u_allowed));
        setIfValid(t, "u_block_category", String(previewTicket.u_block_category || ""));
        setIfValid(t, "u_block_device", String(previewTicket.u_block_device || ""));
        setIfValid(t, "u_block_interface", String(previewTicket.u_block_interface || ""));
        setIfValid(t, "u_block_rule", String(previewTicket.u_block_rule || ""));
        setIfValid(t, "u_block_reason", String(previewTicket.u_block_reason || ""));
        setIfValid(t, "u_forward_query_url", String(previewTicket.u_forward_query_url || ""));
        setIfValid(t, "u_raw_excerpt", String(previewTicket.u_raw_excerpt || ""));
        setIfValid(t, "u_recommended_team", String(previewTicket.u_recommended_team || recommendedTeam(previewTicket.u_block_category)));
        setIfValid(t, "u_forward_evidence_summary", String(previewTicket.u_forward_evidence_summary || evidenceSummary(form, previewTicket)));
      } else {
        setIfValid(t, "u_analysis_status", "not_run");
        setIfValid(t, "u_recommended_team", "triage");
      }
      var sysId = t.insert();
      data.ticketSysId = String(sysId);
      data.ticketNumber = String(t.number || "");
      if (previewHops && previewHops.length) {
        for (var i = 0; i < previewHops.length; i++) {
          var h = previewHops[i] || {};
          var rec = new GlideRecord(hopTable());
          rec.initialize();
          setIfValid(rec, "u_ticket", t.sys_id);
          setIfValid(rec, "u_hop_index", parseInt(String(h.u_hop_index || i + 1), 10) || i + 1);
          setIfValid(rec, "u_device", String(h.u_device || ""));
          setIfValid(rec, "u_ingress", String(h.u_ingress || ""));
          setIfValid(rec, "u_egress", String(h.u_egress || ""));
          setIfValid(rec, "u_note", String(h.u_note || ""));
          rec.insert();
        }
      }
      data.ticket = serializeTicket(t);
      return;
    }

    if (action === "analyze") {
      var form2 = (input && input.form) || {};
      var analyzed = analyzeFromForm(form2);
      data.ticket = analyzed.ticket;
      data.hops = analyzed.hops;
      data.recommendTicket = analyzed.recommendTicket;
      return;
    }

    if (action === "validate_change") {
      var changeForm = (input && input.form) || {};
      var expectedOutcome = String((input && input.expectedOutcome) || changeForm.expectedOutcome || "");
      var changeNumber = String((input && input.changeNumber) || changeForm.changeNumber || "");
      var validation = createChangeValidation(changeForm, expectedOutcome, changeNumber);
      data.validationSysId = validation.sys_id;
      data.validationNumber = validation.number;
      data.validationStatus = validation.status;
      data.validationSummary = validation.summary;
      data.ticket = validation.ticket;
      data.hops = validation.hops;
      data.recommendTicket = false;
      return;
    }

    if (action === "result") {
      var ticketSysId2 = param("ticketSysId");
      if (!ticketSysId2) return bad("ticketSysId required");
      var ticket = new GlideRecord(ticketTable());
      if (!ticket.get(ticketSysId2)) return bad("Ticket not found");
      if (!ticketBelongsToCurrentTenant(ticket, param("tenantUsername"))) return bad("Ticket not found");
      data.ticket = serializeTicket(ticket);

      var hops = [];
      var hopGr = new GlideRecord(hopTable());
      hopGr.addQuery("u_ticket", ticket.sys_id);
      hopGr.orderBy("u_hop_index");
      hopGr.query();
      while (hopGr.next()) hops.push(serializeHop(hopGr));
      data.hops = hops;
      return;
    }

    if (action === "route") {
      var team = String(input.team || "");
      var ticketSysId3 = String(input.ticketSysId || "");
      if (!ticketSysId3) return bad("ticketSysId required");

      var ticket3 = new GlideRecord(ticketTable());
      if (!ticket3.get(ticketSysId3)) return bad("Ticket not found");
      if (!ticketBelongsToCurrentTenant(ticket3, (input && input.tenantUsername) || "")) return bad("Ticket not found");

      var groupSysId = groupForTeam(team);
      if (groupSysId) ticket3.assignment_group = groupSysId;
      setIfValid(ticket3, "u_recommended_team", team || "triage");
      ticket3.work_notes = "Manually routed via Forward workflow demo.";
      ticket3.update();
      data.ticket = serializeTicket(ticket3);
      return;
    }

    if (action === "incident") {
      var ticketSysId4 = String(input.ticketSysId || "");
      if (!ticketSysId4) return bad("ticketSysId required");
      var ticket4 = new GlideRecord(ticketTable());
      if (!ticket4.get(ticketSysId4)) return bad("Ticket not found");
      if (!ticketBelongsToCurrentTenant(ticket4, (input && input.tenantUsername) || "")) return bad("Ticket not found");
      if (!isValidTable("incident")) return bad("incident table is not available");
      var existingIncident = getValue(ticket4, "u_incident");
      if (existingIncident) {
        data.incidentSysId = existingIncident;
        data.incidentNumber = getValue(ticket4, "u_incident_number");
        data.ticket = serializeTicket(ticket4);
        return;
      }

      var inc = new GlideRecord("incident");
      inc.initialize();
      inc.short_description = "Forward evidence: " + getValue(ticket4, "u_src_ip") + " -> " + getValue(ticket4, "u_dst_ip");
      inc.description = getValue(ticket4, "u_forward_evidence_summary") || getValue(ticket4, "u_block_reason");
      inc.impact = "3";
      inc.urgency = "3";
      var sourceCi = getValue(ticket4, "u_source_ci");
      if (sourceCi && hasField(inc, "cmdb_ci")) inc.cmdb_ci = sourceCi;
      var routeTeam = getValue(ticket4, "u_recommended_team") || recommendedTeam(getValue(ticket4, "u_block_category"));
      var routeGroup = groupForTeam(routeTeam);
      if (routeGroup) inc.assignment_group = routeGroup;
      var incidentSysId = inc.insert();
      setIfValid(ticket4, "u_incident", incidentSysId);
      setIfValid(ticket4, "u_incident_number", String(inc.number || ""));
      ticket4.work_notes = "Created ServiceNow incident " + String(inc.number || "") + " from Forward workflow demo.";
      ticket4.update();
      data.incidentSysId = String(incidentSysId);
      data.incidentNumber = String(inc.number || "");
      data.ticket = serializeTicket(ticket4);
      return;
    }

    return bad("Unknown action: " + action);
  } catch (e) {
    return bad(e && e.message ? e.message : "Server error");
  }
})();
