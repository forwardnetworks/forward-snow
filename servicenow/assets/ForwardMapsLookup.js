var ForwardMapsLookup = Class.create();
ForwardMapsLookup.prototype = {
  initialize: function (client) {
    this._client = client || null;
    this._shown = 20;
  },

  // Looks up the Forward Network Maps that match a Change Request. Forward problems become a note,
  // never an error; only a missing connection or a bad id throws.
  forChange: function (changeSysId) {
    if (String(gs.getProperty("__SCOPE__.forward.maps_enabled", "true")) !== "true") {
      return this._result([], "Forward maps are turned off");
    }
    var networkId = String(gs.getProperty("__SCOPE__.forward.network_id", "") || "").replace(/^\s+|\s+$/g, "");
    if (!networkId) return this._result([], "No Forward network is configured (property forward.network_id)");
    // A malformed id is a configuration mistake for an admin to fix, not something to hide in a note.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(networkId)) throw new Error("property forward.network_id is not a valid Forward network ID");
    var id = String(changeSysId || "");
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("change request sys_id is invalid");
    var change = new GlideRecordSecure("change_request");
    if (!change.get(id)) throw new Error("change request was not found");

    var names = this.candidateNames(change);
    if (!names.length) return this._result([], "This change has no configuration item, location or service name to match");
    var listing;
    try {
      listing = (this._client || new ForwardApiClient()).listMaps(networkId);
    } catch (e) {
      if (!e || !e.kind) throw e;
      return this._result([], this._noteFor(e));
    }
    var result = this.match(listing.maps, names);
    if (listing.truncated) result.note = "Forward has more than 1000 maps; only the first 1000 were searched";
    return result;
  },

  // Names the Change Request can be matched on: its configuration item, that item's location, and its service.
  // The name field is read explicitly (a table's display field can be changed), and only where the caller may read it.
  candidateNames: function (change) {
    var paths = ["cmdb_ci.name", "cmdb_ci.location.name", "business_service.name"];
    var names = [];
    for (var i = 0; i < paths.length; i++) {
      var text = "";
      try {
        var element = change.getElement(paths[i]);
        text = element.canRead() ? String(element.getDisplayValue() || "") : "";
      } catch (e) {
        text = "";
      }
      text = text.replace(/^\s+|\s+$/g, "");
      if (text && names.indexOf(text) < 0) names.push(text);
    }
    return names;
  },

  // A map matches when its name equals one of the names, ignoring case and surrounding space.
  match: function (maps, names) {
    var wanted = {};
    for (var i = 0; i < names.length; i++) wanted[String(names[i]).replace(/^\s+|\s+$/g, "").toLowerCase()] = true;
    var matches = [];
    for (var j = 0; j < maps.length; j++) {
      var key = String(maps[j].name || "").replace(/^\s+|\s+$/g, "").toLowerCase();
      if (key && wanted[key] === true) matches.push({ id: maps[j].id, name: maps[j].name, pinned: maps[j].pinned === true });
    }
    return this._result(matches, matches.length ? "" : "No Forward map is named like this change's configuration item, location or service");
  },

  // One line for a form message. Map names come from Forward, so they are escaped before display.
  summaryText: function (result) {
    if (!result.matches.length) return "Forward maps: " + this._escape(result.note || "none found");
    var shown = [];
    for (var i = 0; i < result.matches.length && i < this._shown; i++) shown.push(this._escape(result.matches[i].name));
    var more = result.matches.length > this._shown ? " and " + (result.matches.length - this._shown) + " more" : "";
    return "Forward maps: " + shown.join(", ") + more + (result.note ? ". " + this._escape(result.note) : "");
  },

  _noteFor: function (error) {
    if (error.kind === "forbidden") return "The Forward account may not view Network Maps on this network";
    if (error.kind === "unauthorized") return "Forward rejected the stored credentials";
    if (error.kind === "not_found") return "Forward has no such network or does not offer maps";
    if (error.kind === "rate_limited") return "Forward is rate limiting requests; try again shortly";
    return "Forward maps could not be read (" + error.kind + (error.status ? " " + error.status : "") + ")";
  },

  _result: function (matches, note) {
    return { matches: matches, matchCount: matches.length, note: note };
  },

  _escape: function (text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  type: "ForwardMapsLookup",
};

if (typeof module !== "undefined" && module.exports) module.exports = ForwardMapsLookup;
