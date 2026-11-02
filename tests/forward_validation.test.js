const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const world = { properties: {}, user: "alice", tables: {}, seq: 0, logs: [], change: null, canWrite: true };

global.Class = { create() { return function Constructed() { this.initialize.apply(this, arguments); }; } };
global.gs = {
  getProperty: (name, fallback) => (name in world.properties ? world.properties[name] : fallback),
  getUserName: () => world.user,
  error: (...a) => world.logs.push(a.join(" ")),
  info: (...a) => world.logs.push(a.join(" ")),
  warn: (...a) => world.logs.push(a.join(" ")),
};
const table = (name) => (world.tables[name] = world.tables[name] || []);
global.GlideRecord = class GlideRecord {
  constructor(name) { this.name = name; this.filters = []; this.row = null; this.rows = []; this.index = -1; this.limit = 0; this.sort = null; }
  initialize() { this.row = {}; }
  addQuery(f, a, b) { this.filters.push(b === undefined ? [f, "=", a] : [f, a, b]); }
  orderBy(f) { this.sort = [f, 1]; }
  orderByDesc(f) { this.sort = [f, -1]; }
  setLimit(n) { this.limit = n; }
  query() {
    const src = this.name === "change_request" ? [world.change] : table(this.name);
    let rows = src.filter((r) => this.filters.every(([f, op, v]) => (op === "=" ? String(r[f] ?? "") === String(v) : String(r[f] ?? "") !== String(v))));
    if (this.sort) rows = rows.slice().sort((x, y) => (String(x[this.sort[0]] ?? "") < String(y[this.sort[0]] ?? "") ? -1 : 1) * this.sort[1]);
    this.rows = this.limit ? rows.slice(0, this.limit) : rows;
    this.index = -1;
  }
  next() { this.index += 1; this.row = this.rows[this.index]; return !!this.row; }
  get(id) { this.row = (this.name === "change_request" ? [world.change] : table(this.name)).find((r) => r.sys_id === id) || null; return !!this.row; }
  getUniqueValue() { return this.row.sys_id; }
  getValue(f) { return this.row[f] == null ? null : String(this.row[f]); }
  setValue(f, v) { this.row[f] = v; }
  autoSysFields() {}
  setWorkflow() {}
  insert() {
    if (this.name.endsWith("_validation_run") && this.row.claim && table(this.name).some((r) => r.claim === this.row.claim)) return "";
    this.row.sys_id = (++world.seq).toString(16).padStart(32, "0");
    this.row.sys_created_on = world.seq;
    table(this.name).push(this.row);
    return this.row.sys_id;
  }
  update() { return this.row ? this.row.sys_id : ""; }
};
global.GlideRecordSecure = class GlideRecordSecure {
  get(id) { return !!world.change && world.change.sys_id === id; }
  canWrite() { return world.canWrite; }
  getUniqueValue() { return world.change.sys_id; }
  getValue(f) { return world.change[f] == null ? null : String(world.change[f]); }
};

global.ForwardPathCheck = require("../servicenow/assets/ForwardPathCheck.js");
const ForwardValidation = require("../servicenow/assets/ForwardValidation.js");

const CHANGE = "c".repeat(32);
const NET = "235937";
const SECRET = "secret-device-name-hunter2";
const QID = (n) => "Q_" + String(n).repeat(40);
const COMMIT = "a".repeat(40);

const criterion = (name, expectation, extra = {}) => ({
  sys_id: `k${name}`.padEnd(32, "0"), change: CHANGE, name, active: "true", query_path: `/q/${name}`, expectation,
  severity: "error", query_id: QID(1), commit_id: COMMIT, ...extra,
});

const reset = (criteria = [criterion("a", "no_rows")]) => {
  world.properties = { "__SCOPE__.forward.network_id": NET };
  world.user = "alice";
  world.tables = { __SCOPE___criterion: criteria };
  world.seq = 0;
  world.logs = [];
  world.canWrite = true;
  world.change = { sys_id: CHANGE, number: "CHG0001" };
};

const rows = (n, tag = "r") => ({ count: n, total: n, truncated: false, rowKeys: Array.from({ length: n }, (_, i) => `{"v":"${tag}${i}"}`) });
const fakeClient = (overrides = {}) => {
  const calls = [];
  const rec = (name, value) => (...args) => { calls.push([name, ...args]); const h = overrides[name]; return h ? h(...args) : value; };
  return {
    calls,
    // "100" is the newest by creation time; 200 and 777 are older snapshots of the same network.
    listSnapshots: rec("listSnapshots", [["100", "2026-01-09"], ["200", "2026-01-05"], ["777", "2026-01-01"]].map(([id, day]) => ({ id, state: "PROCESSED", createdAt: `${day}T00:00:00Z`, processedAt: `${day}T00:01:00Z` }))),
    resolveQuery: rec("resolveQuery", { queryId: QID(2), commitId: COMMIT }),
    runQuery: rec("runQuery", rows(0)),
  };
};
const runs = () => table("__SCOPE___validation_run");
const results = () => table("__SCOPE___validation_result");
const kind = (k) => Object.assign(new Error(`body with ${SECRET}`), { kind: k, status: 500 });

test("run refuses before any Forward call: System, not writable, bad id, no network, nothing to run, unpinned", () => {
  const cases = [
    ["system", () => { world.user = "system"; }, CHANGE, /not as System/],
    ["not writable", () => { world.canWrite = false; }, CHANGE, /not permitted/],
    ["bad id", () => {}, "nope", /sys_id is invalid/],
    ["no network", () => { world.properties["__SCOPE__.forward.network_id"] = ""; }, CHANGE, /forward.network_id/],
    ["no criteria", () => { world.tables.__SCOPE___criterion = []; }, CHANGE, /no active criteria/],
    ["unpinned", () => { world.tables.__SCOPE___criterion = [criterion("a", "no_rows", { query_id: "", commit_id: "" })]; }, CHANGE, /bind the criteria first/],
    ["inactive only", () => { world.tables.__SCOPE___criterion = [criterion("a", "no_rows", { active: "false" })]; }, CHANGE, /no active criteria/],
  ];
  for (const [label, arrange, id, pattern] of cases) {
    reset();
    arrange();
    const client = fakeClient();
    assert.throws(() => new ForwardValidation(client).run(id, "", ""), pattern, label);
    assert.equal(client.calls.length, 0, `${label}: no Forward call`);
    assert.equal(runs().length, 0, `${label}: no run claimed`);
  }
});

test("each expectation is judged on the row count or set, and the result carries counts only", () => {
  const cases = [
    ["no_rows", rows(0), "pass"], ["no_rows", rows(3), "fail"],
    ["some_rows", rows(2), "pass"], ["some_rows", rows(0), "fail"],
  ];
  for (const [expectation, answer, expected] of cases) {
    reset([criterion("a", expectation)]);
    new ForwardValidation(fakeClient({ runQuery: () => answer })).run(CHANGE, "", "");
    assert.equal(results()[0].status, expected, `${expectation}/${answer.count}`);
    assert.equal(results()[0].row_count, answer.count);
  }
});

test("no_diff compares the row sets of the snapshot and the baseline, ignoring order and duplicates", () => {
  const same = (a, b) => {
    reset([criterion("a", "no_diff")]);
    const answers = [a, b];
    new ForwardValidation(fakeClient({ runQuery: () => answers.shift() })).run(CHANGE, "200", "100");
    return results()[0].status;
  };
  const make = (keys) => ({ count: keys.length, truncated: false, rowKeys: keys });
  assert.equal(same(make(["x", "y"]), make(["y", "x"])), "pass");
  assert.equal(same(make(["x", "x", "y"]), make(["x", "y"])), "pass");
  assert.equal(same(make(["x"]), make(["x", "z"])), "fail");
  assert.equal(same(make(["x", "y"]), make(["x", "z"])), "fail");
  assert.equal(same({ count: 1, truncated: true, rowKeys: ["x"] }, make(["x"])), "error", "a cut-off side is an error, never a guess");
});

test("no_diff without a baseline is skipped, and a run that measured nothing has no score", () => {
  reset([criterion("a", "no_diff")]);
  const outcome = new ForwardValidation(fakeClient()).run(CHANGE, "200", "");
  assert.equal(results()[0].status, "skipped");
  assert.equal(outcome.status, "not_run");
  assert.equal(outcome.score, "");
  assert.equal(world.change.__SCOPE___validation_status, "not_run");
  assert.equal(world.change.__SCOPE___validation_score, "");
});

test("the baseline defaults to the change's assurance record", () => {
  reset([criterion("a", "no_diff")]);
  table("__SCOPE___assurance").push({ sys_id: "z".repeat(32), change_request: CHANGE, forward_network_id: NET, before_snapshot_id: "777", sys_created_on: 1 });
  const client = fakeClient({ runQuery: () => rows(1) });
  new ForwardValidation(client).run(CHANGE, "200", "");
  assert.deepEqual(client.calls.filter((c) => c[0] === "runQuery").map((c) => c[1]), ["200", "777"]);
  assert.equal(runs()[0].baseline_snapshot_id, "777");
});

test("the snapshot defaults to the newest processed one and is recorded", () => {
  reset();
  const client = fakeClient();
  new ForwardValidation(client).run(CHANGE, "", "");
  assert.equal(runs()[0].snapshot_id, "100");
  assert.equal(client.calls.find((c) => c[0] === "runQuery")[1], "100");
  reset();
  assert.throws(() => new ForwardValidation(fakeClient({ listSnapshots: () => [] })).run(CHANGE, "", ""), /no processed snapshot/);
  assert.equal(runs()[0].outcome, "error");
});

test("the score is 100 minus a penalty per failing or erroring result by severity, floored at 0", () => {
  const penalties = { info: 0, warning: 3, error: 10, critical: 25 };
  for (const [severity, penalty] of Object.entries(penalties)) {
    reset([criterion("a", "no_rows", { severity })]);
    const out = new ForwardValidation(fakeClient({ runQuery: () => rows(1) })).run(CHANGE, "", "");
    assert.equal(out.score, 100 - penalty, severity);
    assert.equal(out.status, "fail");
  }
  reset([criterion("a", "no_rows"), criterion("b", "no_rows", { severity: "critical" }), criterion("c", "no_rows", { severity: "warning" }), criterion("d", "no_rows")]);
  const mixed = new ForwardValidation(fakeClient({ runQuery: () => rows(1) })).run(CHANGE, "", "");
  assert.equal(mixed.score, 100 - 10 - 25 - 3 - 10);
  reset(Array.from({ length: 5 }, (_, i) => criterion(`c${i}`, "no_rows", { severity: "critical" })));
  assert.equal(new ForwardValidation(fakeClient({ runQuery: () => rows(1) })).run(CHANGE, "", "").score, 0);
  reset([criterion("a", "no_rows")]);
  const clean = new ForwardValidation(fakeClient()).run(CHANGE, "", "");
  assert.deepEqual([clean.status, clean.score], ["pass", 100]);
  assert.equal(world.change.__SCOPE___validation_status, "pass");
  assert.equal(world.change.__SCOPE___validation_score, 100);
});

test("a question Forward could not answer is an error with a penalty, never a pass", () => {
  for (const k of ["unauthorized", "forbidden", "not_found", "rate_limited", "server", "unreachable", "invalid_response", "other", undefined]) {
    reset();
    const out = new ForwardValidation(fakeClient({ runQuery: () => { throw kind(k); } })).run(CHANGE, "", "");
    assert.equal(results()[0].status, "error", String(k));
    assert.equal(out.status, "error");
    assert.equal(out.score, 90);
  }
});

test("row content, query text and Forward messages never reach a table, a log, or a thrown error", () => {
  reset([criterion("a", "no_diff"), criterion("b", "no_rows")]);
  const leak = { count: 1, truncated: false, rowKeys: [`{"device":"${SECRET}"}`] };
  new ForwardValidation(fakeClient({ runQuery: () => leak })).run(CHANGE, "200", "100");
  assert.ok(!JSON.stringify([world.tables, world.logs, world.change]).includes(SECRET));
  reset();
  let message = "";
  try { new ForwardValidation(fakeClient({ listSnapshots: () => { throw kind("server"); } })).run(CHANGE, "", ""); } catch (e) { message = e.message; }
  assert.ok(message && !message.includes(SECRET));
  assert.ok(!JSON.stringify([world.tables, world.logs]).includes(SECRET));
});

test("a second run for a change is refused; a finished run frees the claim; a dead run expires", () => {
  reset();
  new ForwardValidation(fakeClient()).run(CHANGE, "", "");
  assert.notEqual(runs()[0].claim, CHANGE, "a finished run releases the claim");
  new ForwardValidation(fakeClient()).run(CHANGE, "", "");
  assert.equal(runs().length, 2);
  runs().push({ sys_id: "d".repeat(32), change: CHANGE, claim: CHANGE, outcome: "running", started_ms: String(Date.now()) });
  const client = fakeClient();
  assert.throws(() => new ForwardValidation(client).run(CHANGE, "", ""), /already running/);
  assert.equal(client.calls.length, 0);
  runs()[2].started_ms = String(Date.now() - 5 * 60 * 60 * 1000);
  new ForwardValidation(fakeClient()).run(CHANGE, "", "");
  assert.equal(runs()[2].outcome, "error");
  assert.equal(runs()[2].detail, "expired");
  assert.throws(() => new ForwardValidation(fakeClient())._claim(CHANGE) && new ForwardValidation(fakeClient())._claim(CHANGE), /already running/);
});

test("a run whose claim was taken stops and leaves the outcome to whoever ended it", () => {
  reset([criterion("a", "no_rows"), criterion("b", "no_rows")]);
  let n = 0;
  const client = fakeClient({
    runQuery: () => {
      if (++n === 1) Object.assign(runs()[0], { outcome: "error", claim: runs()[0].sys_id, detail: "expired" });
      return rows(0);
    },
  });
  assert.throws(() => new ForwardValidation(client).run(CHANGE, "", ""), /ended by another request/);
  assert.equal(runs()[0].detail, "expired");
  assert.equal(world.change.__SCOPE___validation_status, undefined, "an abandoned run does not stamp the change");
});

test("rebind pins every active criterion, clears one it cannot pin, and only reads from Forward", () => {
  reset([criterion("a", "no_rows", { query_id: "", commit_id: "" }), criterion("b", "no_rows", { query_id: QID(9), commit_id: COMMIT })]);
  let n = 0;
  const client = fakeClient({ resolveQuery: () => { if (++n === 2) throw kind("not_found"); return { queryId: QID(5), commitId: "f".repeat(40) }; } });
  const out = new ForwardValidation(client).bind(CHANGE, "true");
  assert.deepEqual(out, { bound: 1, failed: 1, kept: 0 });
  const [a, b] = table("__SCOPE___criterion");
  assert.equal(a.query_id, QID(5));
  assert.equal(b.query_id, "", "a criterion that cannot be pinned is left unbound");
  assert.match(b.binding_note, /not pinned: Forward did not find/);
  assert.ok(!b.binding_note.includes(SECRET));
  assert.deepEqual([...new Set(client.calls.map((c) => c[0]))], ["resolveQuery"]);
  world.user = "system";
  assert.throws(() => new ForwardValidation(fakeClient()).bind(CHANGE), /not as System/);
});

const serverScript = (name) => fs.readFileSync(path.join(__dirname, "..", "servicenow", "scoped-app-template", "src", "server", name), "utf8");

test("the criterion rule: a path edit clears the binding, an insert never keeps one, and a criterion cannot move to another change", () => {
  const fire = ({ operation, pathChanged = false, changeMoved = false }) => {
    const values = { query_id: QID(1), commit_id: COMMIT, binding_note: "pinned", change: "new-change" };
    const current = {
      operation: () => operation,
      query_path: { changes: () => pathChanged },
      change: { changes: () => changeMoved },
      setValue: (f, v) => { values[f] = v; },
    };
    new Function("current", "previous", serverScript("ForwardCriterionRule.server.js"))(current, { getValue: () => "old-change" });
    return values;
  };
  assert.deepEqual(fire({ operation: "update", pathChanged: true }), { query_id: "", commit_id: "", binding_note: "", change: "new-change" });
  assert.deepEqual(fire({ operation: "update" }), { query_id: QID(1), commit_id: COMMIT, binding_note: "pinned", change: "new-change" });
  assert.deepEqual(fire({ operation: "insert" }), { query_id: "", commit_id: "", binding_note: "", change: "new-change" });
  assert.equal(fire({ operation: "update", changeMoved: true }).change, "old-change");
});

test("the revision rule counts every criterion change and marks an earlier verdict stale", () => {
  const fire = (change) => {
    world.change = change;
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
      new Function("current", "previous", serverScript("ForwardCriterionRevisionRule.server.js"))({ getValue: () => CHANGE }, {});
    } finally {
      global.GlideRecord = saved;
    }
    return world.change;
  };
  let after = fire({ sys_id: CHANGE, __SCOPE___criteria_revision: "4", __SCOPE___validation_status: "pass", __SCOPE___validation_score: "100" });
  assert.deepEqual([after.__SCOPE___criteria_revision, after.__SCOPE___validation_status], [5, "stale"]);
  assert.equal(after.__SCOPE___validation_score, "", "a stale verdict keeps no score");
  after = fire({ sys_id: CHANGE, __SCOPE___criteria_revision: "0", __SCOPE___validation_status: "not_run" });
  assert.deepEqual([after.__SCOPE___criteria_revision, after.__SCOPE___validation_status], [1, "not_run"], "nothing to go stale before a first run");
  after = fire({ sys_id: CHANGE });
  assert.equal(after.__SCOPE___criteria_revision, 1);
});

test("the assurance contract assets do not read validation data", () => {
  const dir = path.join(__dirname, "..", "servicenow", "assets");
  for (const file of fs.readdirSync(dir).filter((f) => /^ChangeAssurance/.test(f))) {
    assert.ok(!/validation_(run|result)|_criterion/.test(fs.readFileSync(path.join(dir, file), "utf8")), `${file} must not read validation data`);
  }
});

test("bind leaves already pinned criteria alone unless asked to rebind, because rebinding moves the version", () => {
  reset([criterion("a", "no_rows", { query_id: QID(9), commit_id: COMMIT }), criterion("b", "no_rows", { query_id: "", commit_id: "" })]);
  const client = fakeClient();
  assert.deepEqual(new ForwardValidation(client).bind(CHANGE, ""), { bound: 1, failed: 0, kept: 1 });
  assert.equal(client.calls.filter((c) => c[0] === "resolveQuery").length, 1);
  assert.equal(table("__SCOPE___criterion")[0].query_id, QID(9), "the pinned version did not move");
});

test("bind and run refuse a closed or cancelled change, and bind refuses while a run is active", () => {
  for (const state of ["3", "4"]) {
    reset();
    world.change.state = state;
    const client = fakeClient();
    assert.throws(() => new ForwardValidation(client).run(CHANGE, "", ""), /closed or cancelled/);
    assert.throws(() => new ForwardValidation(client).bind(CHANGE, ""), /closed or cancelled/);
    assert.equal(client.calls.length, 0);
    assert.equal(runs().length, 0);
  }
  reset();
  runs().push({ sys_id: "d".repeat(32), change: CHANGE, claim: CHANGE, outcome: "running", started_ms: String(Date.now()) });
  assert.throws(() => new ForwardValidation(fakeClient()).bind(CHANGE, ""), /is running/);
});

test("a snapshot or baseline that is not one of the configured network's snapshots is refused", () => {
  reset();
  assert.throws(() => new ForwardValidation(fakeClient()).run(CHANGE, "999", ""), /not one of the configured network's/);
  assert.equal(runs()[0].outcome, "error");
  reset();
  assert.throws(() => new ForwardValidation(fakeClient()).run(CHANGE, "200", "999"), /not one of the configured network's/);
  reset([criterion("a", "no_diff")]);
  table("__SCOPE___assurance").push({ sys_id: "z".repeat(32), change_request: CHANGE, forward_network_id: "other-network", before_snapshot_id: "777", sys_created_on: 1 });
  new ForwardValidation(fakeClient()).run(CHANGE, "200", "");
  assert.equal(runs()[0].baseline_snapshot_id, "", "a baseline from another network is not used");
  assert.equal(results()[0].status, "skipped");
});

test("status separates pass from incomplete, error, fail and nothing measured", () => {
  const status = (criteria, handler) => {
    reset(criteria);
    return new ForwardValidation(fakeClient({ runQuery: handler || (() => rows(0)) })).run(CHANGE, "200", "").status;
  };
  assert.equal(status([criterion("a", "no_rows")]), "pass");
  assert.equal(status([criterion("a", "no_rows"), criterion("b", "no_diff")]), "incomplete", "a skipped criterion is not a pass");
  assert.equal(status([criterion("a", "no_rows")], () => { throw kind("server"); }), "error");
  assert.equal(status([criterion("a", "no_rows")], () => rows(1)), "fail");
  assert.equal(status([criterion("a", "no_diff")]), "not_run");
});

test("the verdict goes stale when criteria change during or after the run", () => {
  reset();
  world.change.__SCOPE___criteria_revision = "2";
  const quiet = new ForwardValidation(fakeClient()).run(CHANGE, "200", "");
  assert.equal(quiet.status, "pass");
  assert.equal(world.change.__SCOPE___validation_status, "pass");
  assert.equal(runs()[0].revision, 2);
  reset();
  world.change.__SCOPE___criteria_revision = "2";
  new ForwardValidation(fakeClient({ runQuery: () => { world.change.__SCOPE___criteria_revision = "3"; return rows(0); } })).run(CHANGE, "200", "");
  assert.equal(world.change.__SCOPE___validation_status, "stale", "edited while it ran");
  assert.equal(world.change.__SCOPE___validation_score, "", "and carries no score");
});

test("a run records the snapshot on the change and the pinned versions on each result", () => {
  reset();
  new ForwardValidation(fakeClient()).run(CHANGE, "200", "");
  assert.equal(world.change.__SCOPE___validation_snapshot_id, "200");
  assert.equal(results()[0].query_id, QID(1));
  assert.equal(results()[0].commit_id, COMMIT);
});

test("a run over the criteria cap is refused before any Forward call", () => {
  reset(Array.from({ length: 3 }, (_, i) => criterion(`c${i}`, "no_rows")));
  world.properties["__SCOPE__.forward.validation_max_criteria"] = "2";
  const client = fakeClient();
  assert.throws(() => new ForwardValidation(client).run(CHANGE, "", ""), /more criteria than/);
  assert.equal(client.calls.length, 0);
  assert.equal(runs().length, 0);
});

test("rows checks ask for one row and use the total, so large results are not held", () => {
  reset([criterion("a", "no_rows")]);
  const client = fakeClient({ runQuery: () => ({ count: 1, total: 4200, truncated: true, rowKeys: ['{"a":1}'] }) });
  new ForwardValidation(client).run(CHANGE, "200", "");
  assert.equal(client.calls.find((c) => c[0] === "runQuery")[4], 1);
  assert.equal(results()[0].status, "fail");
  assert.equal(results()[0].row_count, 4200);
});

test("more active criteria than the largest allowed cap are refused, never trimmed to a pass", () => {
  reset(Array.from({ length: 101 }, (_, i) => criterion(`c${String(i).padStart(3, "0")}`, "no_rows")));
  world.properties["__SCOPE__.forward.validation_max_criteria"] = "100";
  const client = fakeClient();
  assert.throws(() => new ForwardValidation(client).run(CHANGE, "", ""), /more criteria than/);
  assert.equal(client.calls.length, 0);
  assert.equal(runs().length, 0);
  assert.equal(world.change.__SCOPE___validation_status, undefined);
});

test("a snapshot that is a draft, a fork or a prediction is refused, as is any that Forward does not list for the network", () => {
  const snapshots = (extra) => [
    { id: "100", state: "PROCESSED", createdAt: "2026-01-09T00:00:00Z", processedAt: "2026-01-09T00:01:00Z" },
    { id: "300", state: "PROCESSED", createdAt: "2026-01-08T00:00:00Z", processingTrigger: "PREDICT", ...extra },
    { id: "400", state: "PROCESSED", createdAt: "2026-01-07T00:00:00Z", isDraft: true },
    { id: "500", state: "PROCESSED", createdAt: "2026-01-06T00:00:00Z", parentSnapshotId: "100" },
  ];
  for (const id of ["300", "400", "500"]) {
    reset();
    assert.throws(() => new ForwardValidation(fakeClient({ listSnapshots: () => snapshots() })).run(CHANGE, id, ""), /not one of the configured network's/, id);
    reset();
    assert.throws(() => new ForwardValidation(fakeClient({ listSnapshots: () => snapshots() })).run(CHANGE, "100", id), /not one of the configured network's/, `baseline ${id}`);
  }
  reset();
  assert.equal(new ForwardValidation(fakeClient({ listSnapshots: () => snapshots() })).run(CHANGE, "100", "").status, "pass");
});

test("bind clears a dead run's claim instead of refusing forever", () => {
  reset();
  runs().push({ sys_id: "d".repeat(32), change: CHANGE, claim: CHANGE, outcome: "running", started_ms: String(Date.now() - 5 * 60 * 60 * 1000) });
  assert.deepEqual(new ForwardValidation(fakeClient()).bind(CHANGE, "true").failed, 0);
  assert.equal(runs()[0].outcome, "error");
});
