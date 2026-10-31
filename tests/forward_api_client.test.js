const assert = require("node:assert/strict");
const test = require("node:test");

// A small stand-in for the ServiceNow globals the script include uses.
const world = { properties: {}, aliases: [], connection: null, responses: [], requests: [] };

global.Class = {
  create() {
    return function Constructed() {
      this.initialize.apply(this, arguments);
    };
  },
};
global.gs = { getProperty: (name, fallback) => (name in world.properties ? world.properties[name] : fallback) };
global.GlideRecord = class GlideRecord {
  constructor() {
    this.index = -1;
  }
  addQuery() {}
  setLimit() {}
  query() {}
  next() {
    this.index += 1;
    return this.index < world.aliases.length;
  }
  getUniqueValue() {
    return world.aliases[this.index];
  }
};
global.sn_cc = {
  ConnectionInfoProvider: class {
    getConnectionInfo() {
      return world.connection;
    }
  },
};
global.sn_ws = {
  RESTMessageV2: class {
    constructor() {
      this.record = { query: {}, headers: {} };
      world.requests.push(this.record);
    }
    setHttpMethod(value) { this.record.method = value; }
    setEndpoint(value) { this.record.endpoint = value; }
    setBasicAuth(user, password) { this.record.auth = [user, password]; }
    setHttpTimeout(value) { this.record.timeout = value; }
    setRequestHeader(name, value) { this.record.headers[name] = value; }
    setQueryParameter(name, value) { this.record.query[name] = value; }
    setLogLevel(value) { this.record.logLevel = value; }
    setRequestBody(value) { this.record.body = value; }
    execute() {
      const next = world.responses.shift();
      if (next instanceof Error) throw next;
      return { getStatusCode: () => next.status, getBody: () => next.body };
    }
  },
};

const ForwardApiClient = require("../servicenow/assets/ForwardApiClient.js");

const connection = (overrides = {}) => {
  const attributes = { connection_url: "https://fwd.example.com/", user_name: "key-id", password: "key-secret", ...overrides };
  return {
    getAttribute: (name) => attributes[name],
    getCredentialAttribute: (name) => attributes[name],
  };
};

const reset = () => {
  world.properties = {};
  world.aliases = ["a".repeat(32)];
  world.connection = connection();
  world.responses = [];
  world.requests = [];
};

const reply = (status, body) => world.responses.push({ status, body: typeof body === "string" ? body : JSON.stringify(body) });

const pathResponse = (paths) => ({ info: { paths, totalHits: { type: "EXACT", value: paths.length } }, timedOut: false });

test("reads the origin and credential from the bound alias and calls the Forward API path route", () => {
  reset();
  reply(200, pathResponse([]));
  new ForwardApiClient().pathSearch({ networkId: "235937", srcIp: "10.0.0.1", dstIp: "10.0.1.5", snapshotId: "snap-1" });
  const [request] = world.requests;
  assert.equal(request.method, "get");
  assert.equal(request.endpoint, "https://fwd.example.com/api/networks/235937/paths");
  assert.deepEqual(request.auth, ["key-id", "key-secret"]);
  assert.equal(request.query.dstIp, "10.0.1.5");
  assert.equal(request.query.srcIp, "10.0.0.1");
  assert.equal(request.query.snapshotId, "snap-1");
  assert.equal(request.query.maxResults, "10");
  assert.equal(request.timeout, 30000);
});

test("refuses to start without exactly one usable HTTPS connection", () => {
  reset();
  world.aliases = [];
  assert.throws(() => new ForwardApiClient(), /alias is not bound/);

  reset();
  world.aliases = ["a".repeat(32), "b".repeat(32)];
  assert.throws(() => new ForwardApiClient(), /ambiguous/);

  reset();
  world.connection = null;
  assert.throws(() => new ForwardApiClient(), /no active connection/);

  reset();
  world.connection = connection({ connection_url: "http://fwd.example.com" });
  assert.throws(() => new ForwardApiClient(), /exact HTTPS origin/);

  reset();
  world.connection = connection({ connection_url: "https://fwd.example.com/api" });
  assert.throws(() => new ForwardApiClient(), /exact HTTPS origin/);

  reset();
  world.connection = connection({ password: "" });
  assert.throws(() => new ForwardApiClient(), /credential is incomplete/);
});

test("rejects out-of-range configuration", () => {
  reset();
  world.properties["__SCOPE__.forward.timeout_ms"] = "100";
  assert.throws(() => new ForwardApiClient(), /timeout must be between/);
  reset();
  world.properties["__SCOPE__.forward.max_path_results"] = "1000";
  assert.throws(() => new ForwardApiClient(), /path result limit/);
});

test("maps HTTP failures to a kind and status without exposing the response body", () => {
  const cases = [[401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [429, "rate_limited"], [503, "server"], [400, "other"]];
  for (const [status, kind] of cases) {
    reset();
    reply(status, "secret-echo-do-not-leak");
    const client = new ForwardApiClient();
    assert.throws(
      () => client.listNetworks(),
      (error) => error.kind === kind && error.status === status && !/secret-echo/.test(error.message),
      `status ${status}`,
    );
  }
});

test("reports transport failure, invalid JSON and oversize responses as distinct kinds", () => {
  reset();
  world.responses.push(new Error("socket detail"));
  assert.throws(() => new ForwardApiClient().listNetworks(), (error) => error.kind === "unreachable" && !/socket/.test(error.message));

  reset();
  reply(200, "<html>not json</html>");
  assert.throws(() => new ForwardApiClient().listNetworks(), (error) => error.kind === "invalid_response");

  reset();
  world.properties["__SCOPE__.forward.max_response_bytes"] = "16384";
  reply(200, JSON.stringify([{ id: "1", name: "x".repeat(20000) }]));
  assert.throws(() => new ForwardApiClient().listNetworks(), (error) => error.kind === "invalid_response" && /too large/.test(error.message));
});

test("validates identifiers and addresses before any request is sent", () => {
  reset();
  const client = new ForwardApiClient();
  const bad = [
    { networkId: "../admin", dstIp: "10.0.0.1", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "10.0.0.1; drop", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "10.0.0.1" },
    { networkId: "1", dstIp: "10.0.0.1", srcIp: "10.0.0.2", snapshotId: "a/b" },
    { networkId: "1", dstIp: "10.0.0.1", srcIp: "10.0.0.2", ipProto: 999 },
    { networkId: "1", dstIp: "ff", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "::::", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "1:2:3", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "1::2::3", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "10.0.0.256.1", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "12345::1", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: ":::", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "1:::2", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "999.999.999.999", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "10.0.0.1/33", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "fe80::1/129", srcIp: "10.0.0.2" },
    { networkId: "1", dstIp: "10.0.0.1", srcIp: "10.0.0.2", dstPort: 0 },
    { networkId: "1", dstIp: "10.0.0.1", srcIp: "10.0.0.2", dstPort: "443; x" },
  ];
  for (const args of bad) {
    assert.throws(() => client.pathSearch(args), (error) => error.kind === "invalid_request");
  }
  assert.equal(world.requests.length, 0);
});

test("a path summary keeps outcomes and device names only, bounded by the result limit", () => {
  reset();
  world.properties["__SCOPE__.forward.max_path_results"] = "2";
  const hop = (deviceName) => ({ deviceName, ingressInterface: "ge-0/0/1", egressInterface: "ge-0/0/2", behaviors: ["SECRET"] });
  reply(200, pathResponse([
    { forwardingOutcome: "DELIVERED", securityOutcome: "PERMITTED", hops: [hop("edge-1"), hop("core-1"), hop("edge-1")] },
    { forwardingOutcome: "DROPPED", securityOutcome: "DENIED", hops: [hop("edge-2")] },
    { forwardingOutcome: "LOOP", securityOutcome: "PERMITTED", hops: [hop("edge-3")] },
  ]));
  const summary = new ForwardApiClient().pathSearch({ networkId: "1", srcIp: "10.0.0.1", dstIp: "10.0.0.2" });
  assert.equal(summary.pathCount, 3);
  assert.equal(summary.paths.length, 2);
  assert.deepEqual(summary.forwardingOutcomes, ["DELIVERED", "DROPPED"]);
  assert.deepEqual(summary.securityOutcomes, ["PERMITTED", "DENIED"]);
  assert.deepEqual(summary.paths[0].devices, ["edge-1", "core-1"]);
  assert.equal(summary.paths[0].hopCount, 3);
  assert.deepEqual(summary.totalHits, { type: "EXACT", value: 3 });
  assert.doesNotMatch(JSON.stringify(summary), /ge-0\/0|SECRET/);
});

test("lists snapshots with the fields Forward sends, keeping the trigger and parent for selection", () => {
  reset();
  reply(200, { snapshots: [
    { id: "s1", state: "PROCESSED", createdAt: "2026-05-11T15:27:24.657Z", processedAt: "2026-10-21T08:04:53.143881490Z", isDraft: false, processingTrigger: "collection" },
    { id: "s2", state: "PROCESSING", isDraft: true, parentSnapshotId: "s1" },
  ] });
  const snapshots = new ForwardApiClient().listSnapshots("42");
  assert.equal(world.requests[0].endpoint, "https://fwd.example.com/api/networks/42/snapshots");
  assert.deepEqual(snapshots, [
    { id: "s1", state: "PROCESSED", createdAt: "2026-05-11T15:27:24.657Z", processedAt: "2026-10-21T08:04:53.143881490Z", isDraft: false, parentSnapshotId: "", processingTrigger: "COLLECTION" },
    { id: "s2", state: "PROCESSING", createdAt: "", processedAt: "", isDraft: true, parentSnapshotId: "s1", processingTrigger: "" },
  ]);
});

test("accepts IPv4, CIDR and IPv6 addresses", () => {
  reset();
  const client = new ForwardApiClient();
  for (const dstIp of ["10.0.1.5", "10.0.1.0/24", "2001:db8::1", "fe80::1/64", "::", "::ffff:10.0.0.1", "2001:db8:0:0:0:0:0:1", " 10.0.1.5 ", "255.255.255.255/32"]) {
    reply(200, pathResponse([]));
    client.pathSearch({ networkId: "1", srcIp: "10.0.0.1", dstIp, dstPort: 443 });
  }
  assert.equal(world.requests.length, 9);
  assert.equal(world.requests[0].query.dstPort, "443");
});

test("asks Forward for processed, unarchived snapshots only and refuses a full page it cannot order", () => {
  reset();
  reply(200, { snapshots: [] });
  new ForwardApiClient().listSnapshots("42");
  assert.deepEqual(world.requests[0].query, { state: "PROCESSED", includeArchived: "false", limit: "500" });

  reset();
  reply(200, { snapshots: Array.from({ length: 500 }, (_, i) => ({ id: String(i), state: "PROCESSED" })) });
  assert.throws(() => new ForwardApiClient().listSnapshots("42"), (error) => error.kind === "invalid_response" && /limit/.test(error.message));
});

test("a zero status is a transport failure", () => {
  reset();
  reply(0, "");
  assert.throws(() => new ForwardApiClient().listNetworks(), (error) => error.kind === "unreachable");
});

test("lists Network Maps as id, name and pinned only, and flags a list past the cap", () => {
  reset();
  reply(200, { maps: [{ id: "0", name: "Branch A", pinned: true, createdBy: "someone@example.com" }, { id: "1", name: "Branch B" }] });
  const result = new ForwardApiClient().listMaps("235937");
  assert.equal(world.requests[0].endpoint, "https://fwd.example.com/api/networks/235937/maps");
  assert.deepEqual(result, { maps: [{ id: "0", name: "Branch A", pinned: true }, { id: "1", name: "Branch B", pinned: false }], truncated: false });

  reset();
  reply(200, { maps: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), name: "m" })) });
  const big = new ForwardApiClient().listMaps("235937");
  assert.equal(big.maps.length, 1000);
  assert.equal(big.truncated, true);

  reset();
  reply(200, []);
  assert.throws(() => new ForwardApiClient().listMaps("1"), (error) => error.kind === "invalid_response");
});

const NET = "235937";
const CS = "CHG-7";
const COMMANDS = "interface Ethernet1\n description secret-community-xyz\n";

test("createChangeSet posts name and base snapshot to the network's change-sets route and returns the id", () => {
  reset();
  reply(200, { id: CS });
  const id = new ForwardApiClient().createChangeSet(NET, { name: "CHG0001-run1", snapshotId: "1347066", tags: ["fca"] });
  assert.equal(id, CS);
  const request = world.requests[0];
  assert.equal(request.method, "post");
  assert.equal(request.endpoint, "https://fwd.example.com/api/networks/235937/change-sets");
  assert.deepEqual(JSON.parse(request.body), { name: "CHG0001-run1", snapshotId: "1347066", tags: ["fca"] });
});

test("every write keeps request bodies out of the REST log and reads do not need to", () => {
  reset();
  reply(200, { commandErrors: [] });
  reply(200, "");
  reply(200, "");
  reply(200, { id: "77" });
  reply(204, "");
  const client = new ForwardApiClient();
  client.validateCommands(NET, CS, "edge-1", COMMANDS);
  client.setCommands(NET, CS, "edge-1", COMMANDS);
  client.commitChangeSet(NET, CS, "CHG0001 run1");
  client.predict(NET, CS, "CHG0001 run1");
  client.deleteChangeSet(NET, CS);
  assert.deepEqual(world.requests.map((r) => r.logLevel), ["basic", "basic", "basic", "basic", "basic"]);
});

test("validateCommands posts the commands in the body and returns only a count", () => {
  reset();
  reply(200, { commandErrors: [{ message: "bad: description secret-community-xyz" }, { message: "x" }] });
  const result = new ForwardApiClient().validateCommands(NET, CS, "edge-1", COMMANDS);
  assert.deepEqual(result, { errorCount: 2 });
  const request = world.requests[0];
  assert.equal(request.endpoint, "https://fwd.example.com/api/networks/235937/change-sets/CHG-7/devices/edge-1/commands");
  assert.equal(request.query.action, "validate");
  assert.equal(JSON.parse(request.body).commands, COMMANDS);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("setCommands puts the text itself as the body", () => {
  reset();
  reply(200, "");
  new ForwardApiClient().setCommands(NET, CS, "edge-1", COMMANDS);
  const request = world.requests[0];
  assert.equal(request.method, "put");
  assert.equal(request.endpoint, "https://fwd.example.com/api/networks/235937/change-sets/CHG-7/draft/devices/edge-1/commands");
  assert.equal(request.body, COMMANDS);
  assert.match(request.headers["Content-Type"], /^text\/plain/);
});

test("commit and predict send a required non-blank note and predict returns the snapshot id", () => {
  reset();
  reply(200, {});
  reply(200, { id: "1400001" });
  const client = new ForwardApiClient();
  client.commitChangeSet(NET, CS, "CHG0001 run1");
  assert.equal(client.predict(NET, CS, "CHG0001 run1"), "1400001");
  assert.equal(world.requests[0].query.note, "CHG0001 run1");
  assert.equal(world.requests[1].query.action, "predict");
  assert.equal(world.requests[1].query.note, "CHG0001 run1");
  for (const bad of ["", "   "]) {
    reset();
    assert.throws(() => new ForwardApiClient().commitChangeSet(NET, CS, bad), (e) => e.kind === "invalid_request");
  }
  reset();
  reply(200, {});
  assert.throws(() => new ForwardApiClient().predict(NET, CS, "n"), (e) => e.kind === "invalid_response");
});

test("deleteChangeSet treats 404 as already gone and any other failure as an error", () => {
  reset();
  reply(404, "");
  assert.equal(new ForwardApiClient().deleteChangeSet(NET, CS), true);
  reset();
  reply(500, "");
  assert.throws(() => new ForwardApiClient().deleteChangeSet(NET, CS), (e) => e.kind === "server");
});

test("predictedSnapshots reads the change set's list, including failed states", () => {
  reset();
  reply(200, [{ id: "1", state: "processed" }, { id: "2", state: "FAILED" }]);
  const result = new ForwardApiClient().predictedSnapshots(NET, CS);
  assert.deepEqual(result, [{ id: "1", state: "PROCESSED" }, { id: "2", state: "FAILED" }]);
  assert.equal(world.requests[0].endpoint, "https://fwd.example.com/api/networks/235937/change-sets/CHG-7/predicted-snapshots");
});

test("device names allow dots and are encoded; unsafe ones and oversize commands are refused before any call", () => {
  reset();
  reply(200, "");
  new ForwardApiClient().setCommands(NET, CS, "edge-1.lab:1", "x");
  assert.ok(world.requests[0].endpoint.includes("/draft/devices/edge-1.lab%3A1/commands"), world.requests[0].endpoint);
  for (const device of ["", "a/b", "../x", "a b"]) {
    reset();
    assert.throws(() => new ForwardApiClient().setCommands(NET, CS, device, "x"), (e) => e.kind === "invalid_request");
    assert.equal(world.requests.length, 0);
  }
  reset();
  assert.throws(() => new ForwardApiClient().setCommands(NET, CS, "edge-1", "a".repeat(70000)), (e) => e.kind === "invalid_request");
  assert.throws(() => new ForwardApiClient().setCommands(NET, CS, "edge-1", "  \n"), (e) => e.kind === "invalid_request");
});

test("ids Forward returns are checked before they are stored or used in later paths", () => {
  for (const bad of ["../x", "a b", "", "a".repeat(80)]) {
    reset();
    reply(200, { id: bad });
    assert.throws(() => new ForwardApiClient().createChangeSet(NET, { name: "n", snapshotId: "1" }), (e) => e.kind === "invalid_response");
    reset();
    reply(200, { id: bad });
    assert.throws(() => new ForwardApiClient().predict(NET, CS, "n"), (e) => e.kind === "invalid_response");
  }
});

test("a 403 keeps only the refusal's kind, never its text", () => {
  const cases = [
    ["Unlicensed operation: PREDICT_MODELING", { kind: "license", detail: "PREDICT_MODELING" }],
    ["Missing permission: VIEW_NETWORK_MAPS", { kind: "rbac", detail: "VIEW_NETWORK_MAPS" }],
    ["Your license has expired", { kind: "license_expired", detail: "" }],
    ["AI_ENABLED is off for your organization", { kind: "org_setting", detail: "AI_ENABLED" }],
  ];
  for (const [message, expected] of cases) {
    reset();
    reply(403, { message: `${message} secret-body-text` });
    let caught;
    try { new ForwardApiClient()._get("/x", null); } catch (e) { caught = e; }
    assert.equal(caught.kind, "forbidden");
    if (message.startsWith("Your license")) assert.equal(caught.denial.kind, expected.kind);
    else assert.deepEqual(caught.denial, expected);
    assert.ok(!JSON.stringify(caught).includes("secret-body-text") && !caught.message.includes("secret"));
  }
  reset();
  reply(403, "not json");
  let plain;
  try { new ForwardApiClient()._get("/x", null); } catch (e) { plain = e; }
  assert.equal(plain.denial, null);
  reset();
  reply(403, { message: "Missing permission: lower-case-and spaces" });
  try { new ForwardApiClient()._get("/x", null); } catch (e) { plain = e; }
  assert.equal(plain.denial.detail, "", "a detail that is not a plain name is dropped");
});

test("capabilities asks with read-only calls and reports available, refused with a reason, or unknown", () => {
  reset();
  reply(200, []);
  reply(200, { chats: [] });
  const ok = new ForwardApiClient().capabilities(NET);
  assert.deepEqual(ok, { predict: { available: true, reason: "" }, ai: { available: true, reason: "" } });
  assert.deepEqual(world.requests.map((r) => r.method), ["get", "get"]);
  assert.equal(world.requests[0].endpoint, "https://fwd.example.com/api/networks/235937/change-sets");
  assert.equal(world.requests[1].endpoint, "https://fwd.example.com/api/ai-chats");

  reset();
  reply(403, { message: "Unlicensed operation: PREDICT_MODELING" });
  reply(403, { message: "FORWARD_AI is off for your organization" });
  const refused = new ForwardApiClient().capabilities(NET);
  assert.deepEqual(refused.predict, { available: false, reason: "license: PREDICT_MODELING" });
  assert.deepEqual(refused.ai, { available: false, reason: "org_setting: FORWARD_AI" });

  reset();
  reply(500, "");
  reply(404, "");
  const mixed = new ForwardApiClient().capabilities(NET);
  assert.deepEqual(mixed.predict, { available: null, reason: "could not tell (server)" });
  assert.deepEqual(mixed.ai, { available: false, reason: "not offered" });

  reset();
  reply(200, { chats: [] });
  const noNetwork = new ForwardApiClient().capabilities("");
  assert.equal(noNetwork.predict.available, null);
  assert.equal(world.requests.length, 1, "no change-set call without a predict network");
});

const COMMIT = "a".repeat(40);
const QID = "Q_" + "b".repeat(40);

test("resolveQuery pins a saved path to a query id at the head commit", () => {
  reset();
  reply(200, JSON.stringify(COMMIT));
  reply(200, { queryId: QID, commitCount: 1 });
  assert.deepEqual(new ForwardApiClient().resolveQuery("/Org/My Check"), { queryId: QID, commitId: COMMIT });
  assert.equal(world.requests[0].endpoint, "https://fwd.example.com/api/nqe/repos/org/commits/head");
  assert.equal(world.requests[1].endpoint, `https://fwd.example.com/api/nqe/repos/org/commits/${COMMIT}/queries`);
  assert.equal(world.requests[1].query.path, "/Org/My Check");
});

test("resolveQuery refuses a bad path before any call and an unusable answer after", () => {
  for (const bad of ["", "no-leading-slash", "/a\nb", "/" + "x".repeat(600)]) {
    reset();
    assert.throws(() => new ForwardApiClient().resolveQuery(bad), (e) => e.kind === "invalid_request");
    assert.equal(world.requests.length, 0);
  }
  reset();
  reply(200, JSON.stringify("not-a-commit"));
  assert.throws(() => new ForwardApiClient().resolveQuery("/a"), (e) => e.kind === "invalid_response");
  reset();
  reply(200, JSON.stringify(COMMIT));
  reply(200, { queryId: "../x" });
  assert.throws(() => new ForwardApiClient().resolveQuery("/a"), (e) => e.kind === "invalid_response");
  reset();
  reply(200, JSON.stringify(COMMIT));
  reply(404, { message: "No query at /a" });
  assert.throws(() => new ForwardApiClient().resolveQuery("/a"), (e) => e.kind === "not_found");
});

test("runQuery needs a pinned query and returns a count and canonical keys, never raw rows", () => {
  reset();
  reply(200, { items: [{ b: 1, a: [2, { z: 1, y: null }] }, { a: 1 }], totalNumItems: 2 });
  const result = new ForwardApiClient().runQuery("1347066", QID, COMMIT, 1001);
  assert.deepEqual(result, { count: 2, total: 2, truncated: false, rowKeys: ['{"a":[2,{"y":null,"z":1}],"b":1}', '{"a":1}'] });
  const request = world.requests[0];
  assert.equal(request.method, "post");
  assert.equal(request.query.snapshotId, "1347066");
  assert.deepEqual(JSON.parse(request.body), { queryId: QID, commitId: COMMIT, queryOptions: { limit: 1001 } });
  assert.equal(request.logLevel, "basic");
  for (const [qid, cid] of [["", COMMIT], [QID, ""], ["Q_short", COMMIT], [QID, "zz"]]) {
    reset();
    assert.throws(() => new ForwardApiClient().runQuery("1", qid, cid, 10), (e) => e.kind === "invalid_request");
    assert.equal(world.requests.length, 0);
  }
});

test("runQuery reports truncation from the total, and a Forward query error carries no message text", () => {
  reset();
  reply(200, { items: [{ a: 1 }], totalNumItems: 50 });
  assert.equal(new ForwardApiClient().runQuery("1", QID, COMMIT, 1).truncated, true);
  reset();
  reply(400, { message: "Error encountered while executing the NQE query", errors: [{ message: "row had secret-device-name" }] });
  let caught;
  try { new ForwardApiClient().runQuery("1", QID, COMMIT, 10); } catch (e) { caught = e; }
  assert.equal(caught.kind, "other");
  assert.equal(caught.status, 400);
  assert.ok(!JSON.stringify(caught).includes("secret-device-name") && !caught.message.includes("secret"));
});

test("a query error that arrives with a 200 is refused without reading its text", () => {
  for (const body of [{ reason: "NQE_RUNTIME_ERROR", errors: [{ message: "row had secret-device-name" }] }, { items: [], errors: [{ message: "secret-device-name" }] }]) {
    reset();
    reply(200, body);
    let caught;
    try { new ForwardApiClient().runQuery("1", QID, COMMIT, 10); } catch (e) { caught = e; }
    assert.equal(caught.kind, "invalid_response");
    assert.ok(!JSON.stringify(caught).includes("secret-device-name"));
  }
});
