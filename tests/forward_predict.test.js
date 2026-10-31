const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// In-memory stand-ins for the ServiceNow globals ForwardPredict uses.
const world = { properties: {}, user: "alice", tables: {}, seq: 0, logs: [], change: null, canWrite: true };

global.Class = {
  create() {
    return function Constructed() {
      this.initialize.apply(this, arguments);
    };
  },
};
global.gs = {
  getProperty: (name, fallback) => (name in world.properties ? world.properties[name] : fallback),
  getUserName: () => world.user,
  error: (...args) => world.logs.push(args.join(" ")),
  info: (...args) => world.logs.push(args.join(" ")),
  warn: (...args) => world.logs.push(args.join(" ")),
};

const table = (name) => (world.tables[name] = world.tables[name] || []);

global.GlideRecord = class GlideRecord {
  constructor(name) {
    this.name = name;
    this.filters = [];
    this.row = null;
    this.rows = [];
    this.index = -1;
    this.limit = 0;
    this.sort = null;
  }
  initialize() { this.row = {}; }
  addQuery(field, a, b) { this.filters.push(b === undefined ? [field, "=", a] : [field, a, b]); }
  orderBy(field) { this.sort = [field, 1]; }
  orderByDesc(field) { this.sort = [field, -1]; }
  setLimit(n) { this.limit = n; }
  query() {
    let rows = table(this.name).filter((r) => this.filters.every(([f, op, v]) => (op === "=" ? String(r[f] ?? "") === String(v) : String(r[f] ?? "") !== String(v))));
    if (this.sort) rows = rows.slice().sort((x, y) => (String(x[this.sort[0]] ?? "") < String(y[this.sort[0]] ?? "") ? -1 : 1) * this.sort[1]);
    this.rows = this.limit ? rows.slice(0, this.limit) : rows;
    this.index = -1;
  }
  next() { this.index += 1; this.row = this.rows[this.index]; return !!this.row; }
  get(id) { this.row = table(this.name).find((r) => r.sys_id === id) || null; return !!this.row; }
  getUniqueValue() { return this.row.sys_id; }
  getValue(f) { return this.row[f] == null ? null : String(this.row[f]); }
  setValue(f, v) { this.row[f] = v; }
  insert() {
    // The run table's claim column is unique; a duplicate insert returns nothing, as ServiceNow does.
    if (this.name.endsWith("_predict_run") && this.row.claim && table(this.name).some((r) => r.claim === this.row.claim)) return "";
    this.row.sys_id = (++world.seq).toString(16).padStart(32, "0");
    this.row.sys_created_on = world.seq;
    table(this.name).push(this.row);
    return this.row.sys_id;
  }
  update() { return this.row ? this.row.sys_id : ""; }
  deleteMultiple() { world.tables[this.name] = table(this.name).filter((r) => !this.filters.every(([f, , v]) => String(r[f] ?? "") === String(v))); }
};
global.GlideRecordSecure = class GlideRecordSecure {
  get(id) { return !!world.change && world.change.sys_id === id; }
  canWrite() { return world.canWrite; }
  getValue(f) { return world.change[f] == null ? null : String(world.change[f]); }
};

const ForwardPathCheck = require("../servicenow/assets/ForwardPathCheck.js");
global.ForwardPathCheck = ForwardPathCheck;
const ForwardPredict = require("../servicenow/assets/ForwardPredict.js");

const CHANGE = "c".repeat(32);
const SECRET = "snmp-community-hunter2";
const NET = "predictnet";

const fakeClient = (overrides = {}) => {
  const calls = [];
  const record = (name, value) => (...args) => {
    calls.push([name, ...args]);
    const handler = overrides[name];
    return handler ? handler(...args) : value;
  };
  return {
    calls,
    listSnapshots: record("listSnapshots", [{ id: "100", state: "PROCESSED", createdAt: "2026-01-01T00:00:00Z", processedAt: "2026-01-01T00:01:00Z" }]),
    createChangeSet: record("createChangeSet", "CHG-7"),
    validateCommands: record("validateCommands", { errorCount: 0 }),
    setCommands: record("setCommands", undefined),
    commitChangeSet: record("commitChangeSet", undefined),
    predict: record("predict", "200"),
    predictedSnapshots: record("predictedSnapshots", [{ id: "200", state: "PROCESSING" }]),
    deleteChangeSet: record("deleteChangeSet", true),
  };
};

const reset = (proposals = [["edge-1", `snmp-server community ${SECRET} RO`]]) => {
  world.properties = { "__SCOPE__.forward.predict_enabled": "true", "__SCOPE__.forward.predict_network_id": NET };
  world.user = "alice";
  world.tables = {};
  world.seq = 0;
  world.logs = [];
  world.canWrite = true;
  world.change = { sys_id: CHANGE, number: "CHG0001", __SCOPE___predict_revision: "3" };
  for (const [device, commands] of proposals) {
    table("__SCOPE___predict_proposal").push({ sys_id: `p${device}`.padEnd(32, "0"), change: CHANGE, device_name: device, commands });
  }
};
const runs = () => table("__SCOPE___predict_run");
const names = (client) => client.calls.map((c) => c[0]);
const failure = (kind) => Object.assign(new Error(`response body with ${SECRET}`), { kind, status: 500 });

test("refuses before any Forward call unless enabled, confirmed, configured, a real user, and permitted", () => {
  const cases = [
    ["not confirmed", () => {}, ["start", CHANGE, "yes"], /confirm/],
    ["disabled", () => { world.properties["__SCOPE__.forward.predict_enabled"] = "false"; }, ["start", CHANGE, "true"], /not enabled/],
    ["no network", () => { world.properties["__SCOPE__.forward.predict_network_id"] = " "; }, ["start", CHANGE, "true"], /predict_network_id/],
    ["bad network", () => { world.properties["__SCOPE__.forward.predict_network_id"] = "a/b"; }, ["start", CHANGE, "true"], /valid Forward network/],
    ["system user", () => { world.user = "system"; }, ["start", CHANGE, "true"], /not as System/],
    ["not writable", () => { world.canWrite = false; }, ["start", CHANGE, "true"], /not permitted/],
    ["bad id", () => {}, ["start", "nope", "true"], /sys_id is invalid/],
    ["no proposals", () => { world.tables["__SCOPE___predict_proposal"] = []; }, ["start", CHANGE, "true"], /no proposed commands/],
    ["too many devices", () => { world.properties["__SCOPE__.forward.predict_max_devices"] = "1"; table("__SCOPE___predict_proposal").push({ sys_id: "x".repeat(32), change: CHANGE, device_name: "edge-2", commands: "x" }); }, ["start", CHANGE, "true"], /more devices/],
  ];
  for (const [label, arrange, [method, id, confirm], pattern] of cases) {
    reset();
    arrange();
    const client = fakeClient();
    assert.throws(() => new ForwardPredict(client)[method](id, confirm), pattern, label);
    assert.equal(client.calls.length, 0, `${label}: no Forward call`);
    assert.equal(runs().length, 0, `${label}: no run claimed`);
  }
});

test("a start runs create, validate, stage, commit, predict in that order and saves the ids as it goes", () => {
  reset([["edge-2", "x"], ["edge-1", "y"]]);
  const client = fakeClient();
  const result = new ForwardPredict(client).start(CHANGE, "true");
  assert.deepEqual(names(client), ["listSnapshots", "createChangeSet", "validateCommands", "validateCommands", "setCommands", "setCommands", "commitChangeSet", "predict"]);
  assert.equal(result.outcome, "pending");
  assert.equal(result.predictedSnapshotId, "200");
  const [run] = runs();
  assert.equal(run.outcome, "pending");
  assert.equal(run.change_set_id, "CHG-7");
  assert.equal(run.predicted_snapshot_id, "200");
  assert.equal(run.claim, CHANGE, "an active run holds the change id as its claim");
  assert.equal(run.revision, 3);
  const commit = client.calls.find((c) => c[0] === "commitChangeSet");
  assert.ok(String(commit[3]).trim().length > 0, "the commit note is not blank");
  assert.equal(client.calls.find((c) => c[0] === "createChangeSet")[2].snapshotId, "100", "based on the newest processed snapshot");
});

test("Forward's refusal of the commands stops the start before anything is staged, and cleans up", () => {
  reset();
  const client = fakeClient({ validateCommands: () => ({ errorCount: 2 }) });
  assert.throws(() => new ForwardPredict(client).start(CHANGE, "true"), /refused the proposed commands/);
  assert.ok(!names(client).includes("setCommands"));
  assert.ok(!names(client).includes("commitChangeSet"));
  assert.ok(names(client).includes("deleteChangeSet"));
  const [run] = runs();
  assert.equal(run.outcome, "failed");
  assert.equal(run.cleanup, "cleaned");
  assert.notEqual(run.claim, CHANGE, "a finished run releases the claim");
  assert.equal(run.change_set_id, "CHG-7", "the id was saved before validation");
});

test("a failed delete leaves the run open for a later cleanup", () => {
  reset();
  const client = fakeClient({ commitChangeSet: () => { throw failure("server"); }, deleteChangeSet: () => { throw failure("server"); } });
  assert.throws(() => new ForwardPredict(client).start(CHANGE, "true"), /server error/);
  const [run] = runs();
  assert.equal(run.outcome, "failed");
  assert.equal(run.cleanup, "open");
  const later = fakeClient();
  assert.equal(new ForwardPredict(later).cleanup(CHANGE), 1);
  assert.equal(runs()[0].cleanup, "cleaned");
});

test("a second start while a run is active is refused with no Forward call; the unique claim holds even if the check is raced", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  const second = fakeClient();
  assert.throws(() => new ForwardPredict(second).start(CHANGE, "true"), /already running/);
  assert.equal(second.calls.length, 0);
  assert.equal(runs().length, 1);
  // Raced: skip the pre-check and go straight to the claim.
  const racer = new ForwardPredict(fakeClient());
  assert.throws(() => racer._claim(CHANGE, NET, 3), /already running/);
});

test("a start that loses its claim deletes the change set it made and leaves the run to whoever ended it", () => {
  reset();
  const client = fakeClient({
    validateCommands: () => {
      Object.assign(runs()[0], { outcome: "failed", claim: runs()[0].sys_id, detail: "expired" });
      return { errorCount: 0 };
    },
  });
  assert.throws(() => new ForwardPredict(client).start(CHANGE, "true"), /ended by another request/);
  assert.ok(names(client).includes("deleteChangeSet"));
  assert.ok(!names(client).includes("commitChangeSet"));
  assert.equal(runs()[0].detail, "expired");
});

test("a start that died is expired by the next call and no longer blocks the change", () => {
  reset();
  table("__SCOPE___predict_run").push({ sys_id: "r".repeat(32), change: CHANGE, claim: CHANGE, outcome: "starting", cleanup: "open", change_set_id: "CHG-1", network_id: NET, started_ms: String(Date.now() - 14 * 60 * 1000), revision: 3 });
  const client = fakeClient();
  new ForwardPredict(client).start(CHANGE, "true");
  assert.equal(runs()[0].outcome, "failed");
  assert.equal(runs()[0].detail, "expired");
  assert.deepEqual(client.calls.find((c) => c[0] === "deleteChangeSet").slice(1), [NET, "CHG-1"], "the dead run's change set is removed");
  assert.equal(runs().length, 2);
});

test("refresh maps Forward's snapshot states: processed answers, failed states fail, anything else waits", () => {
  const cases = [["PROCESSED", "answered"], ["FAILED", "failed"], ["CANCELED", "failed"], ["TIMED_OUT", "failed"], ["RESTORE_FAILED", "failed"], ["PROCESSING", "pending"], ["QUEUED", "pending"]];
  for (const [state, expected] of cases) {
    reset();
    new ForwardPredict(fakeClient()).start(CHANGE, "true");
    const result = new ForwardPredict(fakeClient({ predictedSnapshots: () => [{ id: "200", state }] })).refresh(CHANGE);
    assert.equal(result.outcome, expected, state);
    assert.equal(runs()[0].outcome, expected, state);
    assert.equal(runs()[0].claim === CHANGE, expected === "pending", `${state}: claim released only when the run ends`);
  }
});

test("an unlisted snapshot stays pending until the claim expires, then fails; a request error is not an answer", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  assert.equal(new ForwardPredict(fakeClient({ predictedSnapshots: () => [] })).refresh(CHANGE).outcome, "pending");
  assert.throws(() => new ForwardPredict(fakeClient({ predictedSnapshots: () => { throw failure("unreachable"); } })).refresh(CHANGE), /could not be reached/);
  assert.equal(runs()[0].outcome, "pending");
  runs()[0].started_ms = String(Date.now() - 7 * 60 * 60 * 1000);
  assert.equal(new ForwardPredict(fakeClient({ predictedSnapshots: () => [] })).refresh(CHANGE).outcome, "failed");
});

test("a finished run is never reopened by a late refresh", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  const predictor = new ForwardPredict(fakeClient({
    predictedSnapshots: () => {
      Object.assign(runs()[0], { outcome: "failed", claim: runs()[0].sys_id, detail: "stopped by cleanup", cleanup: "cleaned" });
      return [{ id: "200", state: "PROCESSED" }];
    },
  }));
  predictor.refresh(CHANGE);
  assert.equal(runs()[0].outcome, "failed");
});

// Runs the real revision rule script against a fake change, as ServiceNow would on a proposal insert, update or delete.
const fireRevisionRule = (proposal) => {
  const source = fs.readFileSync(path.join(__dirname, "..", "servicenow", "scoped-app-template", "src", "server", "ForwardPredictRevisionRule.server.js"), "utf8").replace(/__SCOPE__/g, "__SCOPE__");
  const saved = global.GlideRecord;
  global.GlideRecord = class {
    get(id) { return id === CHANGE; }
    getValue(f) { return world.change[f] == null ? null : String(world.change[f]); }
    setValue(f, v) { world.change[f] = v; }
    autoSysFields() {}
    setWorkflow() {}
    update() { return true; }
  };
  try {
    new Function("current", "previous", `${source}`)({ getValue: (f) => proposal[f] }, {});
  } finally {
    global.GlideRecord = saved;
  }
};

test("an answer is stale once the proposal changes: the rule counts an insert, an update and a delete", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  const processed = () => fakeClient({ predictedSnapshots: () => [{ id: "200", state: "PROCESSED" }] });
  assert.equal(new ForwardPredict(processed()).refresh(CHANGE).stale, false);
  for (const _event of ["insert", "update", "delete"]) {
    const before = Number(world.change.__SCOPE___predict_revision);
    fireRevisionRule({ change: CHANGE });
    assert.equal(Number(world.change.__SCOPE___predict_revision), before + 1, _event);
    assert.equal(new ForwardPredict(processed()).refresh(CHANGE).stale, true, `${_event} makes the answer stale`);
  }
  assert.doesNotThrow(() => fireRevisionRule({ change: "" }), "a proposal with no change is ignored");
});

test("a closed or cancelled change is refused before any claim", () => {
  for (const state of ["3", "4"]) {
    reset();
    world.change.state = state;
    const client = fakeClient();
    assert.throws(() => new ForwardPredict(client).start(CHANGE, "true"), /closed or cancelled/);
    assert.equal(client.calls.length, 0);
    assert.equal(runs().length, 0);
  }
});

test("a run ended during the predict call is not reopened by the end of the start", () => {
  reset();
  const client = fakeClient({
    predict: () => {
      Object.assign(runs()[0], { outcome: "failed", claim: runs()[0].sys_id, detail: "stopped by cleanup", cleanup: "cleaned" });
      return "200";
    },
  });
  assert.throws(() => new ForwardPredict(client).start(CHANGE, "true"), /ended by another request/);
  assert.equal(runs()[0].outcome, "failed");
  assert.equal(runs()[0].detail, "stopped by cleanup");
});

test("a healthy slow start is not expired: the limit follows the device cap and the HTTP timeout", () => {
  reset();
  table("__SCOPE___predict_run").push({ sys_id: "r".repeat(32), change: CHANGE, claim: CHANGE, outcome: "starting", cleanup: "open", change_set_id: "CHG-1", network_id: NET, started_ms: String(Date.now() - 11 * 60 * 1000), revision: 3 });
  const client = fakeClient();
  assert.throws(() => new ForwardPredict(client).start(CHANGE, "true"), /already running/);
  assert.equal(client.calls.length, 0);
  world.properties["__SCOPE__.forward.predict_max_devices"] = "50";
  world.properties["__SCOPE__.forward.timeout_ms"] = "120000";
  runs()[0].started_ms = String(Date.now() - 3 * 60 * 60 * 1000);
  assert.throws(() => new ForwardPredict(fakeClient()).start(CHANGE, "true"), /already running/, "3 h is inside the 50-device, 120 s bound");
  runs()[0].started_ms = String(Date.now() - 4 * 60 * 60 * 1000);
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  assert.equal(runs()[0].detail, "expired");
});

test("a late refresh still reads an answer instead of reporting the run expired", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  runs()[0].started_ms = String(Date.now() - 8 * 60 * 60 * 1000);
  const result = new ForwardPredict(fakeClient({ predictedSnapshots: () => [{ id: "200", state: "PROCESSED" }] })).refresh(CHANGE);
  assert.equal(result.outcome, "answered");
});

test("closing a change during a start stops the start at its next ownership check and leaves no change set", () => {
  reset();
  const client = fakeClient({
    createChangeSet: () => {
      // The change closes after the claim but before create returns: cleanup sees a run with no change set yet.
      new ForwardPredict(fakeClient()).cleanup(CHANGE, { purge: true, endStarting: true });
      return "CHG-7";
    },
  });
  assert.throws(() => new ForwardPredict(client).start(CHANGE, "true"), /ended by another request|stopped/);
  assert.ok(names(client).includes("deleteChangeSet"), "the change set it created is removed");
  assert.ok(!names(client).includes("commitChangeSet"));
});

test("a re-predict's cleanup never ends an active start", () => {
  reset();
  table("__SCOPE___predict_run").push({ sys_id: "r".repeat(32), change: CHANGE, claim: CHANGE, outcome: "starting", cleanup: "open", change_set_id: "", network_id: NET, started_ms: String(Date.now()), revision: 3 });
  new ForwardPredict(fakeClient()).cleanup(CHANGE);
  assert.equal(runs()[0].outcome, "starting");
});

test("cleanup deletes the change set of finished and failed runs, drops proposals only when asked, and never throws", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  new ForwardPredict(fakeClient({ predictedSnapshots: () => [{ id: "200", state: "PROCESSED" }] })).refresh(CHANGE);
  const client = fakeClient();
  assert.equal(new ForwardPredict(client).cleanup(CHANGE, { purge: false }), 1);
  assert.equal(runs()[0].cleanup, "cleaned");
  assert.equal(table("__SCOPE___predict_proposal").length, 1, "proposals stay for a re-predict");
  new ForwardPredict(fakeClient()).cleanup(CHANGE, { purge: true });
  assert.equal(table("__SCOPE___predict_proposal").length, 0);
  assert.doesNotThrow(() => new ForwardPredict(fakeClient({ deleteChangeSet: () => { throw failure("server"); } })).cleanup("not-an-id"));
});

test("cleanup of a running change ends the run, works as System, and is not gated by the opt-in", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  world.properties["__SCOPE__.forward.predict_enabled"] = "false";
  world.user = "system";
  assert.equal(new ForwardPredict(fakeClient()).cleanup(CHANGE, { purge: true }), 1);
  assert.equal(runs()[0].outcome, "failed");
  assert.equal(runs()[0].cleanup, "cleaned");
});

test("a run is cleaned only when Forward confirms; an unconfirmed delete stays open", () => {
  reset();
  new ForwardPredict(fakeClient()).start(CHANGE, "true");
  assert.equal(new ForwardPredict(fakeClient({ deleteChangeSet: () => false })).cleanup(CHANGE), 0);
  assert.equal(runs()[0].cleanup, "open");
});

test("command text never reaches a thrown error, a run field, or a log, whatever the failure", () => {
  const kinds = ["unauthorized", "forbidden", "not_found", "rate_limited", "server", "unreachable", "invalid_response", "invalid_request", undefined];
  for (const stage of ["createChangeSet", "validateCommands", "setCommands", "commitChangeSet", "predict"]) {
    for (const kind of kinds) {
      reset();
      const client = fakeClient({ [stage]: () => { throw failure(kind); } });
      let message = "";
      try {
        new ForwardPredict(client).start(CHANGE, "true");
      } catch (e) {
        message = e.message;
      }
      assert.ok(message, `${stage}/${kind} must fail`);
      const everything = JSON.stringify([message, runs(), world.logs]);
      assert.ok(!everything.includes(SECRET), `${stage}/${kind} leaked the command or response text`);
    }
  }
});

test("only the validation and staging calls receive the commands", () => {
  reset();
  const client = fakeClient();
  new ForwardPredict(client).start(CHANGE, "true");
  for (const call of client.calls) {
    const carries = JSON.stringify(call).includes(SECRET);
    assert.equal(carries, call[0] === "validateCommands" || call[0] === "setCommands", call[0]);
  }
});

test("the prediction is advisory: no assurance asset reads the predict tables or script include", () => {
  const dir = path.join(__dirname, "..", "servicenow", "assets");
  for (const file of fs.readdirSync(dir).filter((f) => /^ChangeAssurance/.test(f))) {
    assert.ok(!/predict/i.test(fs.readFileSync(path.join(dir, file), "utf8")), `${file} must not read Predict data`);
  }
});
