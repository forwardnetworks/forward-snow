function ($scope, spUtil) {
  var c = this;

  function payload(r) {
    if (!r) return {};
    if (r.data && typeof r.data === "object") return r.data;
    if (typeof r === "object") return r;
    return {};
  }
  function sendUpdate(action, extra) {
    c.data = c.data || {};
    c.data.action = action;
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (k) {
        c.data[k] = extra[k];
      });
    }
    return c.server.update();
  }

  function clearRunArtifacts() {
    c.state.ticketSysId = "";
    c.state.ticketNumber = "";
    c.state.incidentSysId = "";
    c.state.incidentNumber = "";
    c.state.validationSysId = "";
    c.state.validationNumber = "";
    c.state.validationStatus = "";
    c.state.validationSummary = "";
  }

  c.state = {
    loading: true,
    working: false,
    error: "",
    networks: [],
    snapshots: [],
    cis: [],
    status: {},
    ticketSysId: "",
    ticketNumber: "",
    incidentSysId: "",
    incidentNumber: "",
    validationSysId: "",
    validationNumber: "",
    validationStatus: "",
    validationSummary: "",
    result: null,
    hops: [],
    recommendTicket: false,
  };

  c.form = {
    networkId: "",
    snapshotId: "",
    sourceCiSysId: "",
    destinationCiSysId: "",
    srcIp: "",
    dstIp: "",
    protocol: "",
    dstPort: "",
    changeNumber: "",
    expectedOutcome: "blocked",
  };

  c.statusItems = function () {
    var st = c.state.status || {};
    return [
      {
        label: "Forward binding",
        value: st.tenantUsername || "not bound",
        ok: !!st.tenantUsername && !st.bindingError,
      },
      {
        label: "Forward networks",
        value: String(c.state.networks.length || 0),
        ok: c.state.networks.length > 0,
      },
      {
        label: "ServiceNow CIs",
        value: String(c.state.cis.length || 0),
        ok: c.state.cis.length > 0,
      },
      {
        label: "Incident table",
        value: st.incidentTableReady ? "available" : "missing",
        ok: !!st.incidentTableReady,
      },
      {
        label: "Change validation",
        value: st.changeValidationTableReady && st.changeRequestTableReady ? "available" : "limited",
        ok: !!st.changeValidationTableReady,
      },
    ];
  };

  c.snapshotLabel = function (s) {
    s = s || {};
    return s.note || s.processedAt || s.createdAt || s.id;
  };

  c.ciLabel = function (ci) {
    ci = ci || {};
    var bits = [ci.name || ci.sys_id];
    if (ci.ip_address) bits.push(ci.ip_address);
    if (ci.model_id) bits.push(ci.model_id);
    return bits.join(" - ");
  };

  c.findCi = function (sysId) {
    var list = c.state.cis || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].sys_id === sysId) return list[i];
    }
    return null;
  };

  c.recommendedTeam = function (category) {
    var cgy = String(category || "").toLowerCase();
    if (cgy === "security") return "security";
    if (cgy === "analysis_error") return "triage";
    return "network";
  };

  c.onCiChange = function (kind) {
    if (kind === "source") {
      var source = c.findCi(c.form.sourceCiSysId);
      if (source && source.ip_address) c.form.srcIp = source.ip_address;
    }
    if (kind === "destination") {
      var destination = c.findCi(c.form.destinationCiSysId);
      if (destination && destination.ip_address) c.form.dstIp = destination.ip_address;
    }
    c.state.result = null;
    c.state.hops = [];
    c.state.recommendTicket = false;
    clearRunArtifacts();
  };

  c.init = function () {
    c.state.loading = true;
    c.server.get({ action: "init" }).then(
      function (r) {
        var data = payload(r);
        if (data.error) {
          c.state.error = String(data.error);
          c.state.loading = false;
          return;
        }
        c.state.networks = data.networks || c.data.networks || [];
        c.state.cis = data.cis || [];
        c.state.status = data.status || {};
        if (c.state.networks.length && !c.form.networkId) {
          c.form.networkId = data.defaultNetworkId || c.state.networks[0].id;
          c.onNetworkChange();
        }
        c.state.loading = false;
      },
      function () {
        c.state.error = "Failed to load networks";
        c.state.loading = false;
      },
    );
  };

  c.onNetworkChange = function () {
    c.state.snapshots = [];
    c.form.snapshotId = "";
    if (!c.form.networkId) return;
    c.state.working = true;
    c.server.get({ action: "snapshots", networkId: c.form.networkId }).then(
      function (r) {
        var data = payload(r);
        if (data.error) {
          c.state.error = String(data.error);
          c.state.working = false;
          return;
        }
        c.state.snapshots = data.snapshots || [];
        if (c.state.snapshots.length) c.form.snapshotId = c.state.snapshots[0].id;
        c.state.working = false;
      },
      function () {
        c.state.error = "Failed to load snapshots";
        c.state.working = false;
      },
    );
  };

  c.createTicket = function () {
    c.state.error = "";
    c.state.working = true;
    sendUpdate("create", { form: c.form, previewTicket: c.state.result, previewHops: c.state.hops }).then(
      function (r) {
        var data = payload(r);
        if (data.error) {
          c.state.error = String(data.error);
          c.state.working = false;
          return;
        }
        c.state.ticketSysId = data.ticketSysId || "";
        c.state.ticketNumber = data.ticketNumber || "";
        c.state.incidentSysId = "";
        c.state.incidentNumber = "";
        c.state.result = data.ticket || c.state.result;
        c.state.working = false;
      },
      function () {
        c.state.error = "Failed to create ticket";
        c.state.working = false;
      },
    );
  };

  c.analyze = function () {
    c.state.error = "";
    c.state.working = true;
    sendUpdate("analyze", { form: c.form }).then(
      function (r) {
        var data = payload(r);
        if (data.error) {
          c.state.error = String(data.error);
          c.state.working = false;
          return;
        }
        c.state.result = data.ticket || null;
        c.state.hops = data.hops || [];
        c.state.recommendTicket = !!data.recommendTicket;
        clearRunArtifacts();
        c.state.working = false;
      },
      function () {
        c.state.error = "Failed to run analysis";
        c.state.working = false;
      },
    );
  };

  c.pollResult = function (attempt) {
    c.server.get({ action: "result", ticketSysId: c.state.ticketSysId }).then(
      function (r) {
        var data = payload(r);
        if (data.error) {
          c.state.error = String(data.error);
          c.state.working = false;
          return;
        }
        c.state.result = data.ticket || null;
        c.state.hops = data.hops || [];
        c.state.incidentSysId = c.state.result ? c.state.result.u_incident : "";
        c.state.incidentNumber = c.state.result ? c.state.result.u_incident_number : "";

        var st = c.state.result ? c.state.result.u_analysis_status : "";
        if (st === "running" && attempt < 20) {
          setTimeout(function () {
            c.pollResult(attempt + 1);
          }, 1500);
          return;
        }
        if (st === "error") c.state.error = c.state.result.u_analysis_error || "Analysis failed";
        c.state.working = false;
      },
      function () {
        c.state.error = "Failed to load result";
        c.state.working = false;
      },
    );
  };

  c.route = function (team) {
    c.state.error = "";
    c.state.working = true;
    sendUpdate("route", { ticketSysId: c.state.ticketSysId, team: team }).then(
      function () {
        c.pollResult(0);
      },
      function () {
        c.state.error = "Failed to route ticket";
        c.state.working = false;
      },
    );
  };

  c.createIncident = function () {
    c.state.error = "";
    c.state.working = true;
    sendUpdate("incident", { ticketSysId: c.state.ticketSysId }).then(
      function (r) {
        var data = payload(r);
        if (data.error) {
          c.state.error = String(data.error);
          c.state.working = false;
          return;
        }
        c.state.incidentSysId = data.incidentSysId || "";
        c.state.incidentNumber = data.incidentNumber || "";
        c.state.result = data.ticket || c.state.result;
        c.state.working = false;
      },
      function () {
        c.state.error = "Failed to create incident";
        c.state.working = false;
      },
    );
  };

  c.validateChange = function () {
    c.state.error = "";
    c.state.working = true;
    sendUpdate("validate_change", {
      form: c.form,
      changeNumber: c.form.changeNumber,
      expectedOutcome: c.form.expectedOutcome,
    }).then(
      function (r) {
        var data = payload(r);
        if (data.error) {
          c.state.error = String(data.error);
          c.state.working = false;
          return;
        }
        c.state.validationSysId = data.validationSysId || "";
        c.state.validationNumber = data.validationNumber || "";
        c.state.validationStatus = data.validationStatus || "";
        c.state.validationSummary = data.validationSummary || "";
        c.state.result = data.ticket || null;
        c.state.hops = data.hops || [];
        c.state.recommendTicket = false;
        c.state.working = false;
      },
      function () {
        c.state.error = "Failed to validate change";
        c.state.working = false;
      },
    );
  };

  c.init();
}
