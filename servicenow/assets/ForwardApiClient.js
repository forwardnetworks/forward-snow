var ForwardApiClient = Class.create();
ForwardApiClient.prototype = {
  initialize: function () {
    this._aliasName = "Forward API";
    this._timeoutMs = parseInt(gs.getProperty("__SCOPE__.forward.timeout_ms", "30000"), 10);
    this._maxResponseBytes = parseInt(gs.getProperty("__SCOPE__.forward.max_response_bytes", "1048576"), 10);
    this._maxResults = parseInt(gs.getProperty("__SCOPE__.forward.max_path_results", "10"), 10);
    this._maxSnapshots = 500;
    var connection = this._connectionInfo();
    this._origin = String(connection.getAttribute("connection_url") || "").replace(/\/+$/, "");
    this._username = String(connection.getCredentialAttribute("user_name") || "");
    this._password = String(connection.getCredentialAttribute("password") || "");
    this._validateConfiguration();
  },

  listNetworks: function () {
    var body = this._get("/networks", null);
    if (!Array.isArray(body)) throw this._failure("invalid_response", 200, "Forward network list was not an array");
    var networks = [];
    for (var i = 0; i < body.length && i < 500; i++) {
      var item = body[i] || {};
      networks.push({ id: String(item.id || ""), name: String(item.name || "") });
    }
    return networks;
  },

  // Saved Network Maps (an unpublished Forward route). Needs the VIEW_NETWORK_MAPS operation on the network.
  listMaps: function (networkId) {
    var body = this._get("/networks/" + this._identifier(networkId, "networkId") + "/maps", null);
    var items = body && Array.isArray(body.maps) ? body.maps : null;
    if (!items) throw this._failure("invalid_response", 200, "Forward map list was not an array");
    var maps = [];
    for (var i = 0; i < items.length && i < 1000; i++) {
      var item = items[i] || {};
      maps.push({ id: String(item.id || ""), name: String(item.name || ""), pinned: item.pinned === true });
    }
    return { maps: maps, truncated: items.length > 1000 };
  },

  // ---- Change sets and Predict (unpublished Forward routes; shapes follow the forward-python-sdk spec) ----

  createChangeSet: function (networkId, args) {
    var value = args || {};
    var body = { name: this._text(value.name, "name", 128), snapshotId: this._identifier(value.snapshotId, "snapshotId") };
    if (value.description) body.description = this._text(value.description, "description", 256);
    if (value.tags && value.tags.length) body.tags = value.tags.map(function (tag) { return String(tag).substring(0, 64); });
    var created = this._request("post", this._changeSets(networkId), null, { json: body });
    var id = created && created.id ? String(created.id) : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw this._failure("invalid_response", 200, "Forward did not return a usable change set id");
    return id;
  },

  // Validation stores nothing. Only the number of errors is returned: the error text can echo the commands.
  validateCommands: function (networkId, changeSetId, deviceName, commands) {
    var path = this._changeSets(networkId) + "/" + this._identifier(changeSetId, "changeSetId") + "/devices/" +
      this._device(deviceName) + "/commands";
    var body = { commands: this._commands(commands), cursorLineNum: 1, cursorColumnNum: 1 };
    var result = this._request("post", path, { action: "validate" }, { json: body });
    var errors = result && Array.isArray(result.commandErrors) ? result.commandErrors : [];
    return { errorCount: errors.length };
  },

  setCommands: function (networkId, changeSetId, deviceName, commands) {
    var path = this._changeSets(networkId) + "/" + this._identifier(changeSetId, "changeSetId") + "/draft/devices/" +
      this._device(deviceName) + "/commands";
    this._request("put", path, null, { text: this._commands(commands) });
  },

  commitChangeSet: function (networkId, changeSetId, note) {
    var path = this._changeSets(networkId) + "/" + this._identifier(changeSetId, "changeSetId") + "/commits";
    this._request("post", path, { note: this._note(note) }, null);
  },

  // Returns the predicted snapshot id. Forward needs a non-blank note.
  predict: function (networkId, changeSetId, note) {
    var path = this._changeSets(networkId) + "/" + this._identifier(changeSetId, "changeSetId");
    var result = this._request("post", path, { action: "predict", note: this._text(note, "note", 200) }, null);
    var id = result && result.id ? String(result.id) : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw this._failure("invalid_response", 200, "Forward did not return a usable predicted snapshot id");
    return id;
  },

  predictedSnapshots: function (networkId, changeSetId) {
    var path = this._changeSets(networkId) + "/" + this._identifier(changeSetId, "changeSetId") + "/predicted-snapshots";
    var body = this._get(path, null);
    var items = Array.isArray(body) ? body : body && Array.isArray(body.snapshots) ? body.snapshots : null;
    if (!items) throw this._failure("invalid_response", 200, "Forward predicted snapshot list was not an array");
    var snapshots = [];
    for (var i = 0; i < items.length && i < 100; i++) {
      var item = items[i] || {};
      snapshots.push({ id: String(item.id || ""), state: String(item.state || "").toUpperCase() });
    }
    return snapshots;
  },

  // True when the change set is gone (deleted now, or already absent).
  deleteChangeSet: function (networkId, changeSetId) {
    this._request("delete", this._changeSets(networkId) + "/" + this._identifier(changeSetId, "changeSetId"), null, { allow404: true });
    return true;
  },

  _changeSets: function (networkId) {
    return "/networks/" + this._identifier(networkId, "networkId") + "/change-sets";
  },

  // Forward refuses a blank note on commit and predict.
  _note: function (value) {
    var text = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
    return this._text(text, "note", 200);
  },

  _device: function (name) {
    var text = String(name == null ? "" : name);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text)) throw this._failure("invalid_request", 0, "deviceName is invalid");
    return encodeURIComponent(text);
  },

  _commands: function (commands) {
    var text = String(commands == null ? "" : commands);
    if (!text.replace(/\s+/g, "") || this._utf8ByteLength(text) > 65536) {
      throw this._failure("invalid_request", 0, "commands are empty or too long");
    }
    return text;
  },

  listSnapshots: function (networkId) {
    var query = { state: "PROCESSED", includeArchived: "false", limit: String(this._maxSnapshots) };
    var body = this._get("/networks/" + this._identifier(networkId, "networkId") + "/snapshots", query);
    var items = body && Array.isArray(body.snapshots) ? body.snapshots : null;
    if (!items) throw this._failure("invalid_response", 200, "Forward snapshot list was not an array");
    // The listing order is not documented, so a full page might hide the newest snapshot. Refuse rather than guess.
    if (items.length >= this._maxSnapshots) {
      throw this._failure("invalid_response", 200, "Forward snapshot list reached its " + this._maxSnapshots + "-item limit");
    }
    var snapshots = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      snapshots.push({
        id: String(item.id || ""),
        state: String(item.state || ""),
        createdAt: item.createdAt ? String(item.createdAt) : "",
        processedAt: item.processedAt ? String(item.processedAt) : "",
        isDraft: item.isDraft === true,
        parentSnapshotId: item.parentSnapshotId ? String(item.parentSnapshotId) : "",
        processingTrigger: item.processingTrigger ? String(item.processingTrigger).toUpperCase() : "",
      });
    }
    return snapshots;
  },

  // Path search for one flow. dstIp is required; srcIp may be omitted when "from" is given.
  pathSearch: function (args) {
    var value = args || {};
    var query = {
      dstIp: this._address(value.dstIp, "dstIp"),
      includeNetworkFunctions: "true",
      maxResults: String(this._maxResults),
    };
    if (value.srcIp) query.srcIp = this._address(value.srcIp, "srcIp");
    if (value.from) query.from = this._text(value.from, "from", 128);
    if (!query.srcIp && !query.from) throw this._failure("invalid_request", 0, "srcIp or from is required");
    if (value.snapshotId) query.snapshotId = this._identifier(value.snapshotId, "snapshotId");
    if (value.ipProto != null) query.ipProto = this._integer(value.ipProto, "ipProto", 0, 255);
    if (value.dstPort != null) query.dstPort = String(this._integer(value.dstPort, "dstPort", 1, 65535));
    var path = "/networks/" + this._identifier(value.networkId, "networkId") + "/paths";
    return this.summarizePaths(this._get(path, query));
  },

  // Reduces a Forward path-search response to the outcome fields and device names. Hop detail is not kept.
  summarizePaths: function (response) {
    var body = response && typeof response === "object" ? response : {};
    var info = body.info && typeof body.info === "object" ? body.info : {};
    var found = Array.isArray(info.paths) ? info.paths : [];
    var summary = {
      pathCount: found.length,
      timedOut: body.timedOut === true,
      totalHits: null,
      forwardingOutcomes: [],
      securityOutcomes: [],
      paths: [],
    };
    if (info.totalHits && typeof info.totalHits === "object") {
      summary.totalHits = { type: String(info.totalHits.type || ""), value: Number(info.totalHits.value || 0) };
    }
    for (var i = 0; i < found.length && i < this._maxResults; i++) {
      var path = found[i] || {};
      var forwarding = String(path.forwardingOutcome || "");
      var security = String(path.securityOutcome || "");
      var hops = Array.isArray(path.hops) ? path.hops : [];
      var devices = [];
      for (var j = 0; j < hops.length && devices.length < 50; j++) {
        var name = hops[j] && hops[j].deviceName ? String(hops[j].deviceName) : "";
        if (name && devices.indexOf(name) < 0) devices.push(name);
      }
      if (forwarding && summary.forwardingOutcomes.indexOf(forwarding) < 0) summary.forwardingOutcomes.push(forwarding);
      if (security && summary.securityOutcomes.indexOf(security) < 0) summary.securityOutcomes.push(security);
      summary.paths.push({ forwardingOutcome: forwarding, securityOutcome: security, hopCount: hops.length, devices: devices });
    }
    return summary;
  },

  _get: function (relativePath, query) {
    return this._request("get", relativePath, query, null);
  },

  // Writes never carry a body into the REST log (log level "basic"), and a failed write is never retried here.
  // options: { json: object } or { text: string }, plus { allow404: true } for deletes.
  _request: function (method, relativePath, query, options) {
    var opts = options || {};
    var rm = new sn_ws.RESTMessageV2();
    rm.setHttpMethod(method);
    rm.setEndpoint(this._origin + "/api" + relativePath);
    rm.setBasicAuth(this._username, this._password);
    rm.setHttpTimeout(this._timeoutMs);
    rm.setRequestHeader("Accept", "application/json");
    if (method !== "get") rm.setLogLevel("basic");
    if (opts.json !== undefined) {
      rm.setRequestHeader("Content-Type", "application/json");
      rm.setRequestBody(JSON.stringify(opts.json));
    } else if (opts.text !== undefined) {
      rm.setRequestHeader("Content-Type", "text/plain; charset=utf-8");
      rm.setRequestBody(String(opts.text));
    }
    var keys = query ? Object.keys(query) : [];
    for (var i = 0; i < keys.length; i++) rm.setQueryParameter(keys[i], String(query[keys[i]]));
    var response;
    try {
      response = rm.execute();
    } catch (e) {
      throw this._failure("unreachable", 0, "Forward API request did not complete");
    }
    var status = response.getStatusCode();
    var text = String(response.getBody() || "");
    if (opts.allow404 && status === 404) return null;
    if (status < 200 || status >= 300) throw this._failure(this._kindFor(status), status, "Forward API returned " + status);
    if (this._utf8ByteLength(text) > this._maxResponseBytes) {
      throw this._failure("invalid_response", status, "Forward API response is too large");
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw this._failure("invalid_response", status, "Forward API returned invalid JSON");
    }
  },

  _kindFor: function (status) {
    if (status === 0) return "unreachable";
    if (status === 401) return "unauthorized";
    if (status === 403) return "forbidden";
    if (status === 404) return "not_found";
    if (status === 429) return "rate_limited";
    if (status >= 500) return "server";
    return "other";
  },

  // Errors carry a kind and status but never the response body, which can echo request data.
  _failure: function (kind, status, message) {
    var error = new Error(message);
    error.kind = kind;
    error.status = status;
    return error;
  },

  _connectionInfo: function () {
    var alias = new GlideRecord("sys_alias");
    alias.addQuery("name", this._aliasName);
    alias.addQuery("sys_scope.scope", "__SCOPE__");
    alias.setLimit(2);
    alias.query();
    if (!alias.next()) throw new Error("Forward API connection alias is not bound");
    var aliasSysId = String(alias.getUniqueValue() || "");
    if (alias.next()) throw new Error("Forward API connection alias is ambiguous");
    var info = new sn_cc.ConnectionInfoProvider().getConnectionInfo(aliasSysId);
    if (!info) throw new Error("Forward API connection alias has no active connection");
    return info;
  },

  _validateConfiguration: function () {
    if (!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(this._origin)) {
      throw new Error("Forward API connection must be an exact HTTPS origin");
    }
    if (!this._username || !this._password) throw new Error("Forward API connection alias credential is incomplete");
    if (!isFinite(this._timeoutMs) || this._timeoutMs < 1000 || this._timeoutMs > 120000) {
      throw new Error("Forward API timeout must be between 1000 and 120000 ms");
    }
    if (!isFinite(this._maxResponseBytes) || this._maxResponseBytes < 16384 || this._maxResponseBytes > 4194304) {
      throw new Error("Forward API response limit must be between 16384 and 4194304 bytes");
    }
    if (!isFinite(this._maxResults) || this._maxResults < 1 || this._maxResults > 100) {
      throw new Error("Forward API path result limit must be between 1 and 100");
    }
  },

  _identifier: function (value, name) {
    var text = String(value == null ? "" : value);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) throw this._failure("invalid_request", 0, name + " is invalid");
    return text;
  },

  _address: function (value, name) {
    var text = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
    if (text.length > 64 || (!this._isIpv4(text) && !this._isIpv6(text))) {
      throw this._failure("invalid_request", 0, name + " is invalid");
    }
    return text;
  },

  _isIpv4: function (text) {
    var parts = text.split("/");
    if (parts.length > 2 || (parts.length === 2 && !(/^[0-9]{1,2}$/.test(parts[1]) && Number(parts[1]) <= 32))) return false;
    if (!/^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(parts[0])) return false;
    var octets = parts[0].split(".");
    for (var i = 0; i < 4; i++) if (Number(octets[i]) > 255) return false;
    return true;
  },

  _isIpv6: function (text) {
    var parts = text.split("/");
    if (parts.length > 2 || (parts.length === 2 && !(/^[0-9]{1,3}$/.test(parts[1]) && Number(parts[1]) <= 128))) return false;
    var address = parts[0];
    if (address.indexOf(":::") >= 0 || address.split("::").length > 2) return false;
    if ((address.charAt(0) === ":" && address.indexOf("::") !== 0) ||
        (address.charAt(address.length - 1) === ":" && address.lastIndexOf("::") !== address.length - 2)) return false;
    var groups = address.split(":");
    var last = groups[groups.length - 1];
    if (last.indexOf(".") >= 0) {
      if (!this._isIpv4(last)) return false;
      groups.splice(groups.length - 1, 1, "0", "0");
    }
    var compressed = address.indexOf("::") >= 0;
    var present = 0;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i] === "") continue;
      if (!/^[0-9A-Fa-f]{1,4}$/.test(groups[i])) return false;
      present += 1;
    }
    return compressed ? present <= 7 : present === 8 && groups.length === 8;
  },

  _integer: function (value, name, min, max) {
    var number = Number(value);
    if (Math.floor(number) !== number || number < min || number > max) {
      throw this._failure("invalid_request", 0, name + " is invalid");
    }
    return number;
  },

  _text: function (value, name, limit) {
    var text = String(value == null ? "" : value);
    if (!text || text.length > limit || /[\u0000-\u001f]/.test(text)) {
      throw this._failure("invalid_request", 0, name + " is invalid");
    }
    return text;
  },

  _utf8ByteLength: function (text) {
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  },

  type: "ForwardApiClient",
};

if (typeof module !== "undefined" && module.exports) module.exports = ForwardApiClient;
