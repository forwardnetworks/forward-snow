var ForwardClient = Class.create();
ForwardClient.prototype = {
  initialize: function (options) {
    if (typeof options === "string") {
      options = { tenantUsername: options };
    }
    options = options || {};
    this._tenantUsername = this._resolveTenantUsername(options.tenantUsername || options.tenantUsernameOverride || "");
  },

  getTenantUsername: function () {
    return this._tenantUsername;
  },

  listNetworks: function () {
    var resp = this._execute("List Networks", {});
    if (!resp || !Array.isArray(resp)) return [];

    var out = [];
    for (var i = 0; i < resp.length; i++) {
      var n = resp[i] || {};
      if (n.id == null) continue;
      var id = String(n.id);
      out.push({ id: id, name: typeof n.name === "string" ? n.name : id });
    }
    return out;
  },

  listSnapshots: function (networkId) {
    if (!networkId) throw new Error("networkId is required");

    var resp = this._execute("List Snapshots", { networkId: networkId });
    if (!resp || typeof resp !== "object") return [];

    var snapshots = Array.isArray(resp.snapshots) ? resp.snapshots : [];
    var out = [];
    for (var i = 0; i < snapshots.length; i++) {
      var s = snapshots[i] || {};
      if (s.id == null) continue;
      out.push({
        id: String(s.id),
        createdAt: typeof s.createdAt === "string" ? s.createdAt : "",
        processedAt: typeof s.processedAt === "string" ? s.processedAt : "",
        note: typeof s.note === "string" ? s.note : "",
        status: typeof s.state === "string" ? s.state : "",
      });
    }
    return out;
  },

  pathSearch: function (args) {
    args = args || {};
    var required = ["networkId", "snapshotId", "srcIp", "dstIp"];
    for (var i = 0; i < required.length; i++) {
      if (!args[required[i]]) throw new Error(required[i] + " is required");
    }

    var maxResults = gs.getProperty("x_fwd_demo.forward.max_results", "10");
    var query = {
      srcIp: args.srcIp,
      dstIp: args.dstIp,
      snapshotId: args.snapshotId,
      includeNetworkFunctions: "true",
      maxResults: String(maxResults),
    };
    if (args.protocol) {
      var ipProto = String(args.protocol).toUpperCase() === "TCP" ? 6 : 17;
      query.ipProto = ipProto;
    }
    if (args.dstPort) query.dstPort = String(args.dstPort);

    return this._execute("Path Search", {
      networkId: args.networkId,
      query: query,
    });
  },

  _execute: function (methodName, opts) {
    opts = opts || {};
    var binding = this._loadBinding();
    var rm = new sn_ws.RESTMessageV2();
    rm.setHttpMethod(this._httpMethodFor(methodName));
    rm.setEndpoint(this._endpointURL(binding, methodName, opts));
    this._applyAuth(rm, binding);
    this._applyTimeout(rm);

    var q = opts.query || {};
    for (var k in q) {
      if (!q.hasOwnProperty(k)) continue;
      rm.setQueryParameter(k, String(q[k]));
    }

    var response = rm.execute();
    var status = response.getStatusCode();
    var body = response.getBody();

    if (status < 200 || status >= 300) {
      throw new Error("Forward API error (" + status + "): " + body);
    }

    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new Error("Failed to parse Forward JSON response");
    }
  },

  _bindingTable: function () {
    return this._tableFromProperty(
      "x_fwd_demo.tables.binding",
      "u_forward_tenant_binding",
      "x_fwd_demo_tenant_binding"
    );
  },

  _tableFromProperty: function (propName, defaultTable, fallbackTable) {
    function isValidTable(name) {
      try {
        var gr = new GlideRecord(String(name || ""));
        return gr && gr.isValid();
      } catch (e) {
        return false;
      }
    }

    var t = String(gs.getProperty(propName, defaultTable) || "");
    if (t && isValidTable(t)) return t;
    if (fallbackTable && isValidTable(fallbackTable)) return String(fallbackTable);
    return String(defaultTable);
  },

  _resolveTenantUsername: function (overrideTenantUsername) {
    var overrideName = String(overrideTenantUsername || "").replace(/^\s+|\s+$/g, "");
    if (overrideName) {
      try {
        if (gs.hasRole("admin")) return overrideName;
      } catch (e) {}
    }
    var current = String(gs.getUserName() || "").replace(/^\s+|\s+$/g, "");
    if (!current) throw new Error("ServiceNow user context is required");
    return current;
  },

  _loadBinding: function () {
    var table = this._bindingTable();
    var gr = new GlideRecord(table);
    gr.addQuery("u_tenant_username", this._tenantUsername);
    gr.setLimit(1);
    gr.query();
    if (!gr.next()) {
      throw new Error("Forward tenant binding not found for " + this._tenantUsername);
    }

    var baseUrl = this._fieldValue(gr, "u_forward_base_url").replace(/\/+$/, "");
    if (!baseUrl) baseUrl = "https://fwd.app/api";
    this._validateBaseUrl(baseUrl);

    var username = this._fieldValue(gr, "u_forward_username");
    var password = this._secretValue(gr, "u_forward_password");
    var authProfileSysId = this._fieldValue(gr, "u_forward_auth_profile");
    if (!authProfileSysId && (!username || !password)) {
      throw new Error("Forward tenant binding is incomplete for " + this._tenantUsername);
    }
    return {
      baseUrl: baseUrl,
      forwardUsername: username,
      forwardPassword: password,
      authProfileSysId: authProfileSysId,
    };
  },

  _applyAuth: function (rm, binding) {
    if (binding.authProfileSysId) {
      rm.setAuthenticationProfile("basic", String(binding.authProfileSysId));
      return;
    }
    rm.setBasicAuth(String(binding.forwardUsername || ""), String(binding.forwardPassword || ""));
  },

  _applyTimeout: function (rm) {
    try {
      var timeout = parseInt(gs.getProperty("x_fwd_demo.forward.request_timeout_ms", "30000"), 10) || 30000;
      rm.setHttpTimeout(timeout);
    } catch (e) {}
  },

  _fieldValue: function (gr, field) {
    try {
      if (!gr.isValidField(field)) return "";
      return String(gr.getValue(field) || "");
    } catch (e) {
      return "";
    }
  },

  _secretValue: function (gr, field) {
    try {
      if (!gr.isValidField(field)) return "";
      var elem = gr.getElement(field);
      if (elem && elem.getDecryptedValue) {
        var decrypted = String(elem.getDecryptedValue() || "");
        if (decrypted) return decrypted;
      }
      return String(gr.getValue(field) || "");
    } catch (e) {
      return "";
    }
  },

  _validateBaseUrl: function (baseUrl) {
    var url = String(baseUrl || "").replace(/\/+$/, "");
    if (url.indexOf("https://") !== 0) {
      throw new Error("Forward base URL must use https");
    }

    var allowedRaw = String(gs.getProperty("x_fwd_demo.forward.allowed_base_urls", "https://fwd.app/api") || "");
    var allowed = allowedRaw.split(",");
    for (var i = 0; i < allowed.length; i++) {
      var candidate = String(allowed[i] || "").replace(/^\s+|\s+$/g, "").replace(/\/+$/, "");
      if (candidate && url === candidate) return;
    }
    throw new Error("Forward base URL is not allowed: " + url);
  },

  _httpMethodFor: function (methodName) {
    switch (methodName) {
      case "List Networks":
      case "List Snapshots":
      case "Path Search":
        return "get";
      default:
        throw new Error("Unknown Forward API method: " + methodName);
    }
  },

  _endpointURL: function (binding, methodName, opts) {
    return String(binding.baseUrl || "").replace(/\/+$/, "") + this._endpointPathFor(methodName, opts);
  },

  _endpointPathFor: function (methodName, opts) {
    switch (methodName) {
      case "List Networks":
        return "/networks";
      case "List Snapshots":
        return "/networks/" + encodeURIComponent(String(opts.networkId || "")) + "/snapshots";
      case "Path Search":
        return "/networks/" + encodeURIComponent(String(opts.networkId || "")) + "/paths";
      default:
        throw new Error("Unknown Forward API method: " + methodName);
    }
  },

  type: "ForwardClient",
};
