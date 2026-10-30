const assert = require("node:assert/strict");
const test = require("node:test");

const world = { properties: {}, change: null, lookups: [], reads: [], unreadable: [] };

global.Class = {
  create() {
    return function Constructed() {
      this.initialize.apply(this, arguments);
    };
  },
};
global.gs = { getProperty: (name, fallback) => (name in world.properties ? world.properties[name] : fallback) };
global.GlideRecordSecure = class GlideRecordSecure {
  constructor(table) {
    world.lookups.push(table);
  }
  get(id) {
    this.found = world.change && world.change.id === id;
    return this.found;
  }
  getElement(path) {
    const value = world.change.fields[path];
    if (value instanceof Error) throw value;
    world.reads.push(path);
    return { canRead: () => !world.unreadable.includes(path), getDisplayValue: () => (value == null ? "" : value) };
  }
};

const ForwardMapsLookup = require("../servicenow/assets/ForwardMapsLookup.js");

const ID = "e".repeat(32);
const configure = (fields = {}, properties = {}) => {
  world.properties = { "__SCOPE__.forward.network_id": "235937", ...properties };
  world.change = { id: ID, fields: { "cmdb_ci.name": "branch-a", "cmdb_ci.location.name": "", "business_service.name": "", ...fields } };
  world.lookups = [];
  world.reads = [];
  world.unreadable = [];
};
const map = (name, id = "1", pinned = false) => ({ id, name, pinned });
const client = (maps, extra = {}) => {
  const calls = [];
  return {
    calls,
    listMaps: (networkId) => {
      calls.push(networkId);
      if (extra.error) throw extra.error;
      return { maps, truncated: extra.truncated === true };
    },
  };
};

test("matches maps by name against the CI, its location and its service, ignoring case and spacing", () => {
  configure({ "cmdb_ci.name": "Branch-A", "cmdb_ci.location.name": "  Lisbon ", "business_service.name": "Payments" });
  const c = client([map("branch-a", "1"), map("LISBON", "2", true), map("Payments ", "3"), map("Branch-A Backup", "4"), map("other", "5")]);
  const result = new ForwardMapsLookup(c).forChange(ID);
  assert.deepEqual(result.matches.map((m) => m.id), ["1", "2", "3"]);
  assert.equal(result.matchCount, 3);
  assert.equal(result.matches[1].pinned, true);
  assert.deepEqual(c.calls, ["235937"]);
  assert.deepEqual(world.reads, ["cmdb_ci.name", "cmdb_ci.location.name", "business_service.name"]);
  assert.deepEqual(world.lookups, ["change_request"]);
});

test("a name that merely contains a map name is not a match", () => {
  configure({ "cmdb_ci.name": "core-router-01" });
  const result = new ForwardMapsLookup(client([map("core"), map("router")])).forChange(ID);
  assert.equal(result.matchCount, 0);
  assert.match(result.note, /No Forward map is named like/);
});

test("repeated names are searched once and unreadable fields are skipped", () => {
  configure({ "cmdb_ci.name": "same", "cmdb_ci.location.name": "same", "business_service.name": new Error("no such field") });
  const change = new global.GlideRecordSecure("change_request");
  change.get(ID);
  assert.deepEqual(new ForwardMapsLookup(client([])).candidateNames(change), ["same"]);
});

test("does nothing when turned off, when no network is configured, or when the change has no names", () => {
  configure({}, { "__SCOPE__.forward.maps_enabled": "false" });
  let c = client([map("branch-a")]);
  assert.match(new ForwardMapsLookup(c).forChange(ID).note, /turned off/);
  assert.equal(c.calls.length, 0);

  configure({}, { "__SCOPE__.forward.network_id": "" });
  c = client([map("branch-a")]);
  assert.match(new ForwardMapsLookup(c).forChange(ID).note, /No Forward network is configured/);
  assert.equal(c.calls.length, 0);

  configure({ "cmdb_ci.name": "", "cmdb_ci.location.name": "", "business_service.name": "" });
  c = client([map("branch-a")]);
  assert.match(new ForwardMapsLookup(c).forChange(ID).note, /no configuration item, location or service/);
  assert.equal(c.calls.length, 0);
});

test("a Forward refusal or failure is a note, never an error, and never carries the response", () => {
  const cases = [["forbidden", /may not view Network Maps/], ["unauthorized", /rejected the stored credentials/], ["not_found", /no such network/],
    ["rate_limited", /rate limiting/], ["server", /could not be read \(server 503\)/], ["unreachable", /could not be read \(unreachable\)/]];
  for (const [kind, pattern] of cases) {
    configure();
    const error = Object.assign(new Error("body-text-do-not-show"), { kind, status: kind === "server" ? 503 : 0 });
    const result = new ForwardMapsLookup(client([], { error })).forChange(ID);
    assert.equal(result.matchCount, 0, kind);
    assert.match(result.note, pattern, kind);
    assert.doesNotMatch(result.note, /body-text/);
  }
});

test("configuration problems are not swallowed", () => {
  configure();
  const broken = { listMaps: () => { throw new Error("Forward API connection alias is not bound"); } };
  assert.throws(() => new ForwardMapsLookup(broken).forChange(ID), /alias is not bound/);
  assert.throws(() => new ForwardMapsLookup(client([])).forChange("nope"), /sys_id is invalid/);
  assert.throws(() => new ForwardMapsLookup(client([])).forChange("f".repeat(32)), /was not found/);
});

test("says so when Forward has more maps than were searched", () => {
  configure();
  const result = new ForwardMapsLookup(client([map("branch-a")], { truncated: true })).forChange(ID);
  assert.equal(result.matchCount, 1);
  assert.match(result.note, /more than 1000 maps/);
});

test("map names are escaped for display and long lists are cut", () => {
  const lookup = new ForwardMapsLookup(client([]));
  const hostile = lookup.summaryText({ matches: [{ name: '<img src=x onerror="alert(1)">&' }], note: "" });
  assert.equal(hostile, "Forward maps: &lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
  const many = Array.from({ length: 25 }, (_, i) => ({ name: "m" + i }));
  const text = lookup.summaryText({ matches: many, note: "" });
  assert.match(text, /m19 and 5 more$/);
  assert.doesNotMatch(text, /m20/);
  assert.equal(lookup.summaryText({ matches: [], note: "a <b> note" }), "Forward maps: a &lt;b&gt; note");
});

test("a name the caller may not read is never used for matching", () => {
  configure({ "cmdb_ci.name": "secret-site", "cmdb_ci.location.name": "hq" });
  world.unreadable = ["cmdb_ci.name"];
  const result = new ForwardMapsLookup(client([map("secret-site", "1"), map("hq", "2")])).forChange(ID);
  assert.deepEqual(result.matches.map((m) => m.id), ["2"]);
});

test("a malformed network id is a configuration error, and a padded one is trimmed", () => {
  for (const bad of ["../x", "12 34", "a".repeat(65)]) {
    configure({}, { "__SCOPE__.forward.network_id": bad });
    assert.throws(() => new ForwardMapsLookup(client([])).forChange(ID), /not a valid Forward network ID/, bad);
  }
  configure({}, { "__SCOPE__.forward.network_id": "  235937  " });
  const c = client([]);
  new ForwardMapsLookup(c).forChange(ID);
  assert.deepEqual(c.calls, ["235937"]);
});

test("the summary keeps a truncation note when there are matches", () => {
  const text = new ForwardMapsLookup(client([])).summaryText({ matches: [{ name: "a" }], note: "Forward has more than 1000 maps; only the first 1000 were searched" });
  assert.equal(text, "Forward maps: a. Forward has more than 1000 maps; only the first 1000 were searched");
});
