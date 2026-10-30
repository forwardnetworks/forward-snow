const assert = require("node:assert/strict");
const test = require("node:test");

const world = { records: {}, secureTables: [], canWrite: true, updateFails: false, userName: "operator.user" };

global.Class = {
  create() {
    return function Constructed() {
      this.initialize.apply(this, arguments);
    };
  },
};
global.gs = { getUserName: () => world.userName };
global.GlideRecordSecure = class GlideRecordSecure {
  constructor(table) {
    world.secureTables.push(table);
    this.values = null;
    this.updated = false;
  }
  get(id) {
    this.values = world.records[id];
    this.id = id;
    return Boolean(this.values);
  }
  canWrite() {
    return world.canWrite;
  }
  getValue(name) {
    return this.values[name] == null ? "" : this.values[name];
  }
  setValue(name, value) {
    this.values[name] = value;
  }
  update() {
    this.updated = true;
    if (world.updateFails) return null;
    world.lastUpdate = this.id;
    return this.id;
  }
};

const ForwardPathCheck = require("../servicenow/assets/ForwardPathCheck.js");

const ID = "c".repeat(32);
const path = (forwardingOutcome, securityOutcome, devices = ["edge-1"]) => ({ forwardingOutcome, securityOutcome, hopCount: devices.length, devices });
const summary = (paths, extra = {}) => ({
  pathCount: paths.length,
  timedOut: false,
  totalHits: { type: "EXACT", value: paths.length },
  forwardingOutcomes: [...new Set(paths.map((p) => p.forwardingOutcome))],
  securityOutcomes: [...new Set(paths.map((p) => p.securityOutcome))],
  paths,
  ...extra,
});
const snapshot = (id, createdAt, extra = {}) => ({
  id, state: "PROCESSED", createdAt, processedAt: createdAt, isDraft: false, parentSnapshotId: "", processingTrigger: "COLLECTION", ...extra,
});
const fakeClient = (overrides = {}) => {
  const calls = { pathSearch: [], listSnapshots: [] };
  return {
    calls,
    listSnapshots: (id) => {
      calls.listSnapshots.push(id);
      return overrides.snapshots || [
        snapshot("old", "2026-01-01T00:00:00.000Z"),
        snapshot("new", "2026-02-01T00:00:00.000Z"),
        snapshot("busy", "2026-03-01T00:00:00.000Z", { state: "PROCESSING" }),
      ];
    },
    pathSearch: (args) => {
      calls.pathSearch.push(args);
      if (overrides.error) throw overrides.error;
      return overrides.summary || summary([path("DELIVERED", "PERMITTED")]);
    },
  };
};
const seed = (values = {}) => {
  world.records = {
    [ID]: {
      forward_network_id: "235937", source_ip: "10.0.0.1", destination_ip: "10.0.1.5", protocol: "TCP",
      destination_port: 443, expected_outcome: "allowed", forward_snapshot_id: "", ...values,
    },
  };
  world.secureTables = [];
  world.canWrite = true;
  world.updateFails = false;
  world.userName = "operator.user";
  world.lastUpdate = null;
  return world.records[ID];
};

test("passes when a delivered, permitted path matches the expected outcome and records the snapshot used", () => {
  const record = seed();
  const client = fakeClient();
  const result = new ForwardPathCheck(client).run(ID);
  assert.deepEqual(result, { status: "pass", observedOutcome: "allowed", snapshotId: "new" });
  assert.equal(record.validation_status, "pass");
  assert.equal(record.observed_outcome, "allowed");
  assert.equal(record.forward_snapshot_id, "new");
  assert.match(record.evidence_summary, /Observed allowed/);
  assert.equal(world.lastUpdate, ID);
  assert.deepEqual(world.secureTables, ["__SCOPE___validation"]);
  assert.deepEqual(client.calls.pathSearch[0], {
    networkId: "235937", srcIp: "10.0.0.1", dstIp: "10.0.1.5", snapshotId: "new", ipProto: 6, dstPort: "443",
  });
});

test("uses a snapshot pinned by the caller as-is and does not list snapshots", () => {
  const record = seed({ protocol: "UDP", destination_port: "" });
  const client = fakeClient();
  new ForwardPathCheck(client).run(ID, "pinned");
  assert.equal(record.forward_snapshot_id, "pinned");
  assert.equal(client.calls.listSnapshots.length, 0);
  assert.equal(client.calls.pathSearch[0].snapshotId, "pinned");
  assert.equal(client.calls.pathSearch[0].ipProto, 17);
  assert.equal("dstPort" in client.calls.pathSearch[0], false);
});

test("fails when the observed outcome differs from the expected one", () => {
  const record = seed({ expected_outcome: "blocked" });
  const result = new ForwardPathCheck(fakeClient()).run(ID);
  assert.equal(result.status, "fail");
  assert.equal(record.observed_outcome, "allowed");
});

test("a dropped or denied flow is observed as blocked", () => {
  seed({ expected_outcome: "blocked" });
  const dropped = fakeClient({ summary: summary([path("DROPPED", "PERMITTED"), path("DELIVERED", "DENIED")]) });
  assert.equal(new ForwardPathCheck(dropped).run(ID).status, "pass");
});

test("records a status of not_run, not a pass, when no expected outcome was set", () => {
  const record = seed({ expected_outcome: "" });
  assert.equal(new ForwardPathCheck(fakeClient()).run(ID).status, "not_run");
  assert.match(record.evidence_summary, /No expected outcome/);
});

test("never turns missing or partial evidence into a verdict", () => {
  const cases = [
    summary([], {}),
    summary([path("DELIVERED", "PERMITTED")], { timedOut: true }),
    summary([path("DROPPED", "PERMITTED")], { totalHits: { type: "LOWER_BOUND", value: 50 } }),
  ];
  for (const bad of cases) {
    const record = seed({ expected_outcome: "blocked" });
    const result = new ForwardPathCheck(fakeClient({ summary: bad })).run(ID);
    assert.equal(result.status, "error");
    assert.equal(record.observed_outcome, "");
  }
});

test("a Forward API failure is recorded as an error with its kind and no response text", () => {
  const record = seed();
  const failure = Object.assign(new Error("Forward API returned 403"), { kind: "forbidden", status: 403 });
  const result = new ForwardPathCheck(fakeClient({ error: failure })).run(ID);
  assert.equal(result.status, "error");
  assert.equal(record.validation_status, "error");
  assert.equal(record.evidence_summary, "Forward API error: forbidden (403)");
});

test("configuration failures are not swallowed", () => {
  seed();
  const broken = fakeClient();
  broken.listSnapshots = () => { throw new Error("Forward API connection alias is not bound"); };
  assert.throws(() => new ForwardPathCheck(broken).run(ID), /alias is not bound/);
});

test("errors when there is no network id or no processed snapshot", () => {
  let record = seed({ forward_network_id: "" });
  assert.equal(new ForwardPathCheck(fakeClient()).run(ID).status, "error");
  assert.match(record.evidence_summary, /network ID is required/);

  record = seed();
  const none = fakeClient({ snapshots: [snapshot("s", "2026-01-01T00:00:00.000Z", { state: "PROCESSING" })] });
  assert.equal(new ForwardPathCheck(none).run(ID).status, "error");
  assert.match(record.evidence_summary, /No processed Forward snapshot/);
});

test("refuses a bad id, a missing record, or a caller without write access, and writes nothing", () => {
  seed();
  assert.throws(() => new ForwardPathCheck(fakeClient()).run("not-an-id"), /sys_id is invalid/);
  assert.throws(() => new ForwardPathCheck(fakeClient()).run("d".repeat(32)), /was not found/);
  world.canWrite = false;
  assert.throws(() => new ForwardPathCheck(fakeClient()).run(ID), /not permitted/);
  assert.equal(world.lastUpdate, null);
  assert.equal(world.records[ID].validation_status, undefined);
});

test("latest snapshot follows Forward's rule: newest created, not newest processed; no drafts, forks or predictions", () => {
  const check = new ForwardPathCheck(fakeClient());
  const reprocessed = snapshot("older-reprocessed", "2026-01-01T00:00:00.000Z", { processedAt: "2026-12-01T00:00:00.000Z", processingTrigger: "REPROCESS" });
  const newest = snapshot("newest", "2026-02-01T00:00:00.000Z", { processedAt: "2026-02-01T01:00:00.000Z" });
  assert.equal(check.latestProcessedSnapshot([reprocessed, newest]), "newest");
  assert.equal(check.latestProcessedSnapshot([newest, reprocessed]), "newest");
  const excluded = [
    snapshot("predicted", "2026-09-01T00:00:00.000Z", { processingTrigger: "PREDICT" }),
    snapshot("fork", "2026-09-02T00:00:00.000Z", { processingTrigger: "FORK" }),
    snapshot("child", "2026-09-03T00:00:00.000Z", { parentSnapshotId: "newest" }),
    snapshot("draft", "2026-09-04T00:00:00.000Z", { isDraft: true }),
    snapshot("unfinished", "2026-09-05T00:00:00.000Z", { state: "PROCESSING" }),
  ];
  assert.equal(check.latestProcessedSnapshot([...excluded, newest]), "newest");
  assert.equal(check.latestProcessedSnapshot(excluded), "");
  const tied = [snapshot("a", "2026-02-01T00:00:00.000Z", { processedAt: "2026-02-01T01:00:00.000Z" }), snapshot("b", "2026-02-01T00:00:00.000Z", { processedAt: "2026-02-01T02:00:00.000Z" })];
  assert.equal(check.latestProcessedSnapshot(tied), "b");
});

test("the snapshot stored on the record is output only: a re-run searches the newest snapshot, not the last one used", () => {
  const record = seed({ forward_snapshot_id: "stale" });
  const client = fakeClient();
  new ForwardPathCheck(client).run(ID);
  assert.equal(client.calls.pathSearch[0].snapshotId, "new");
  assert.equal(record.forward_snapshot_id, "new");
});

test("the recorded snapshot always describes this run, so an error that searched none leaves it blank", () => {
  const record = seed({ forward_network_id: "", forward_snapshot_id: "from-an-earlier-run" });
  new ForwardPathCheck(fakeClient()).run(ID);
  assert.equal(record.validation_status, "error");
  assert.equal(record.forward_snapshot_id, "");
});

test("refuses to run as System because the record ACLs would not apply", () => {
  seed();
  world.userName = "system";
  assert.throws(() => new ForwardPathCheck(fakeClient()).run(ID), /not as System/);
  assert.equal(world.lastUpdate, null);
});

test("an empty or zero destination port means no port filter", () => {
  for (const port of ["", "0", null]) {
    seed({ destination_port: port });
    const client = fakeClient();
    new ForwardPathCheck(client).run(ID);
    assert.equal("dstPort" in client.calls.pathSearch[0], false, String(port));
  }
});

test("an EXACT count that disagrees with the paths returned is not complete", () => {
  for (const hits of [{ type: "EXACT" }, { type: "EXACT", value: 1 }]) {
    seed({ expected_outcome: "blocked" });
    const paths = [path("DROPPED", "DENIED"), path("DROPPED", "DENIED")];
    assert.equal(new ForwardPathCheck(fakeClient({ summary: summary(paths, { totalHits: hits }) })).run(ID).status, "error", JSON.stringify(hits));
  }
});

test("a cut-off result is never reported as blocked, however small the count", () => {
  for (const hits of [{ type: "LOWER_BOUND", value: 1 }, { type: "LOWER_BOUND", value: 10 }, null, { type: "EXACT", value: 3 }]) {
    const record = seed({ expected_outcome: "blocked" });
    const result = new ForwardPathCheck(fakeClient({ summary: summary([path("DROPPED", "DENIED")], { totalHits: hits }) })).run(ID);
    assert.equal(result.status, "error", JSON.stringify(hits));
    assert.equal(record.observed_outcome, "");
  }
});

test("a path with a missing outcome cannot support a blocked verdict, but a delivered permitted path still allows", () => {
  seed({ expected_outcome: "blocked" });
  assert.equal(new ForwardPathCheck(fakeClient({ summary: summary([path("", "DENIED")]) })).run(ID).status, "error");
  seed({ expected_outcome: "allowed" });
  const mixed = summary([path("", ""), path("DELIVERED", "PERMITTED")]);
  assert.equal(new ForwardPathCheck(fakeClient({ summary: mixed })).run(ID).status, "pass");
});

test("a verdict that could not be saved is reported as a failure, not a result", () => {
  seed();
  world.updateFails = true;
  assert.throws(() => new ForwardPathCheck(fakeClient()).run(ID), /could not be saved/);
});

test("bad record input is reported as invalid input, not as a Forward error", () => {
  const record = seed();
  const invalid = Object.assign(new Error("dstIp is invalid"), { kind: "invalid_request", status: 0 });
  new ForwardPathCheck(fakeClient({ error: invalid })).run(ID);
  assert.equal(record.evidence_summary, "Invalid input: dstIp is invalid");
});
