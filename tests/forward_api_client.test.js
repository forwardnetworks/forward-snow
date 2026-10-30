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
