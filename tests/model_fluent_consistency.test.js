const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const model = JSON.parse(fs.readFileSync(path.join(root, "servicenow/scoped-app/application-model.json"), "utf8"));
const fluentDir = path.join(root, "servicenow/scoped-app-template/src/fluent");
const fluent = fs.readdirSync(fluentDir).filter((f) => f.endsWith(".now.ts")).map((f) => fs.readFileSync(path.join(fluentDir, f), "utf8")).join("\n");
const matches = (re) => [...fluent.matchAll(re)].map((m) => m[1]);
const sameSet = (modelNames, sourceNames, label) => {
  assert.deepEqual([...new Set(modelNames)].sort(), [...new Set(sourceNames)].sort(), label);
};

test("the application model lists exactly the properties the Fluent source defines", () => {
  sameSet(model.properties.map((p) => p.logicalName),
    matches(/name: '__SCOPE__\.([A-Za-z0-9_.]+)'/g).filter((n) => /^(assurance|forward)\./.test(n)), "properties");
});

test("the application model lists exactly the script includes the Fluent source defines", () => {
  sameSet(model.scriptIncludes.map((s) => s.logicalName), matches(/ScriptInclude\(\{[^}]*?name: '([A-Za-z0-9]+)'/g), "script includes");
});

test("the application model lists exactly the flow actions the Fluent source defines", () => {
  const defined = matches(/internalName: '([a-z_]+)'/g);
  // The three assurance operations are subflows-backed actions declared with the same internal names.
  sameSet(model.flowActions.map((a) => a.logicalName), defined, "flow actions");
});

test("every table in the model exists in the Fluent schema, and the other way round", () => {
  const defined = matches(/name: '__SCOPE___([a-z_]+)',\n\s+label:/g);
  const aliases = { assurance: "assurance_ledger", validation: "path_validation" };
  sameSet(model.tables.map((t) => t.logicalName), defined.map((n) => aliases[n] || n), "tables");
});

test("the run table has no user write path in the model and no allow-write ACL that can pass", () => {
  const run = model.tables.find((t) => t.logicalName === "predict_run");
  assert.deepEqual(run.writeRoles, []);
  for (const op of ["create", "write", "delete"]) {
    const block = fluent.split("Acl({").find((b) => b.includes(`predict_run_${op}_deny_acl`));
    assert.ok(block && block.includes("answer = false;") && block.includes("adminOverrides: false"), `${op} is closed`);
  }
});

test("the ATF install check names every packaged script include", () => {
  const tests = fs.readFileSync(path.join(fluentDir, "tests.now.ts"), "utf8");
  for (const include of model.scriptIncludes.map((s) => s.logicalName)) {
    assert.ok(tests.includes(`'${include}'`), `${include} is checked on install`);
  }
});

const aclBlock = (id) => fluent.split("Acl({").find((b) => b.includes(`Now.ID['${id}']`));
const closed = (id) => {
  const block = aclBlock(id);
  assert.ok(block, `${id} exists`);
  assert.ok(block.includes("answer = false;") && block.includes("adminOverrides: false"), `${id} can never pass, even for an admin`);
};

test("script-written tables have no user write path: runs and results of validation as well as prediction", () => {
  for (const table of ["validation_run", "validation_result"]) {
    const entry = model.tables.find((t) => t.logicalName === table);
    assert.deepEqual(entry.writeRoles, [], table);
    for (const op of ["create", "write", "delete"]) closed(`${table}_${op}_deny_acl`);
  }
});

test("the Change Request fields an approval policy would read, and the criterion binding, are locked", () => {
  for (const field of ["validation_status", "validation_score", "validation_snapshot_id", "criteria_revision", "predict_revision"]) {
    for (const op of ["create", "write"]) closed(`change_${field}_${op}_acl`);
    assert.ok(model.changeRequestCorrelation.some((c) => c.logicalName === field), `${field} is in the model`);
  }
  for (const field of ["query_id", "commit_id"]) {
    closed(`criterion_${field}_write_acl`);
    closed(`criterion_${field}_create_acl`);
  }
  closed("criterion_binding_note_write_acl");
  closed("criterion_binding_note_create_acl");
});

test("criterion and proposal changes require write access to the parent change", () => {
  for (const id of ["criterion_create_acl", "criterion_write_acl", "criterion_delete_acl", "predict_proposal_read_acl", "predict_proposal_create_acl", "predict_proposal_write_acl", "predict_proposal_delete_acl"]) {
    assert.ok(aclBlock(id).includes("canWrite()"), id);
  }
});
