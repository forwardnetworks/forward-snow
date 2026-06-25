var PathNormalizer = Class.create();
PathNormalizer.prototype = {
  initialize: function () {},

  normalize: function (raw) {
    raw = raw || {};
    var result = {
      allowed: false,
      block_category: "unknown",
      block_device: "",
      block_interface: "",
      block_rule: "",
      block_reason: "",
      query_url: "",
      raw_excerpt: "",
      hops: [],
    };

    try {
      if (raw.queryUrl) result.query_url = String(raw.queryUrl);
      if (!result.query_url && raw.query && raw.query.url) result.query_url = String(raw.query.url);
      result.raw_excerpt = this._excerpt(raw);

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

      var forwardingOutcome = String(p.forwardingOutcome || "").toUpperCase();
      var securityOutcome = String(p.securityOutcome || "").toUpperCase();
      if (forwardingOutcome) {
        result.allowed = forwardingOutcome === "DELIVERED" && securityOutcome !== "DENIED";
      } else {
        result.allowed = Boolean(p.isAllowed || p.allowed || securityOutcome === "PERMITTED");
      }

      var hops = Array.isArray(p.hops) ? p.hops : [];
      result.hops = this._normalizeHops(hops);

      if (!result.allowed) {
        var block = this._findBlock(hops, p);
        if (block) {
          result.block_device = block.device || "";
          result.block_interface = block.interface || "";
          result.block_rule = block.rule || "";
          result.block_reason = block.reason || "Blocked";
          result.block_category = block.category || "unknown";
        } else {
          result.block_reason = "Blocked (unknown location)";
        }
      } else {
        result.block_reason = "Allowed";
      }
      return result;
    } catch (e) {
      result.block_reason = e && e.message ? String(e.message) : "Normalization error";
      return result;
    }
  },

  _normalizeHops: function (hops) {
    var out = [];
    for (var i = 0; i < hops.length; i++) {
      var h = hops[i] || {};
      out.push({
        hop_index: i + 1,
        device: String(h.deviceName || h.device || ""),
        ingress: String(h.inIntf || h.ingressInterface || h.ingress || ""),
        egress: String(h.outIntf || h.egressInterface || h.egress || ""),
        note: String(h.note || ""),
      });
    }
    return out;
  },

  _findBlock: function (hops, pathObj) {
    pathObj = pathObj || {};
    var forwardingOutcome = String(pathObj.forwardingOutcome || "").toUpperCase();
    var securityOutcome = String(pathObj.securityOutcome || "").toUpperCase();
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
        device: lastDevice,
        interface: lastIface,
        rule: "",
        reason: "Blackhole/drop detected. Route to Network.",
        category: "blackhole",
      };
    }

    if (securityOutcome && securityOutcome !== "PERMITTED") {
      return {
        device: lastDevice,
        interface: lastIface,
        rule: "",
        reason: "Security policy blocked traffic. Route to Security.",
        category: "security",
      };
    }

    if (forwardingOutcome && forwardingOutcome !== "DELIVERED") {
      return {
        device: lastDevice,
        interface: lastIface,
        rule: "",
        reason: "Traffic was not delivered correctly. Route to Network.",
        category: "reachability",
      };
    }

    // Best-effort: find the first hop that indicates a deny/drop.
    for (var i = 0; i < hops.length; i++) {
      var h = hops[i] || {};
      if (h.disposition && String(h.disposition).toLowerCase().indexOf("deny") >= 0) {
        return {
          device: String(h.deviceName || h.device || ""),
          interface: String(h.outIntf || h.egressInterface || ""),
          rule: String(h.ruleName || h.rule || ""),
          reason: String(h.disposition || "Denied"),
          category: "security",
        };
      }
      if (h.note && String(h.note).toLowerCase().indexOf("acl") >= 0) {
        return {
          device: String(h.deviceName || h.device || ""),
          interface: String(h.outIntf || h.egressInterface || ""),
          rule: String(h.ruleName || h.rule || ""),
          reason: String(h.note || "Blocked"),
          category: "security",
        };
      }
    }
    return null;
  },

  _excerpt: function (raw) {
    try {
      var s = JSON.stringify(raw);
      if (s.length > 3500) return s.substring(0, 3500) + "...";
      return s;
    } catch (e) {
      return "";
    }
  },

  type: "PathNormalizer",
};
