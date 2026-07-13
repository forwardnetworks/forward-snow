const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../servicenow/assets/ChangeAssuranceIngest_Resource.js"),
  "utf8"
);

const runResource = ({
  body,
  roles = ["x_fwd_demo.assurance_writer"],
  pathParams = {},
  evidenceSha256 = "a".repeat(64),
  serviceError = null,
}) => {
  const statuses = [];
  const calls = [];
  const context = {
    request: {
      body,
      pathParams,
      getHeader: (name) => name === "X-Forward-Dynatrace-SHA256" ? evidenceSha256 : "",
    },
    response: { setStatus: (value) => statuses.push(value) },
    gs: {
      getProperty: (_name, fallback) => fallback,
      hasRole: (role) => roles.indexOf(role) >= 0,
    },
    ChangeAssuranceService: function ChangeAssuranceService() {
      this.ingest = (changeSysId, payload, expectedEvidenceSha256) => {
        if (serviceError) throw serviceError;
        calls.push({ changeSysId, payload, expectedEvidenceSha256 });
        return { idempotencyKey: "forward-dynatrace:" + "a".repeat(64) };
      };
    },
  };
  const result = vm.runInNewContext(source, context);
  return { result: JSON.parse(JSON.stringify(result)), statuses, calls };
};

test("passes the exact raw evidence bytes to the assurance service", () => {
  const raw = '{\n  "schemaVersion": "forward-dynatrace-servicenow-change-assurance-evidence/v1"\n}\n';
  const sysId = "0123456789abcdef0123456789abcdef";
  const execution = runResource({
    body: { dataString: raw, data: { schemaVersion: "different-object" } },
    pathParams: { change_sys_id: sysId },
  });
  assert.deepEqual(execution.statuses, [200]);
  assert.deepEqual(execution.calls, [{
    changeSysId: sysId,
    payload: raw,
    expectedEvidenceSha256: "a".repeat(64),
  }]);
  assert.equal(execution.result.status, "ok");
});

test("rejects callers without the bounded writer role", () => {
  const execution = runResource({ body: { dataString: "{}" }, roles: [] });
  assert.deepEqual(execution.statuses, [403]);
  assert.equal(execution.calls.length, 0);
  assert.equal(execution.result.status, "error");
});

test("rejects an empty request body before invoking the service", () => {
  const execution = runResource({ body: {}, pathParams: { change_sys_id: "0123456789abcdef0123456789abcdef" } });
  assert.deepEqual(execution.statuses, [400]);
  assert.equal(execution.calls.length, 0);
  assert.match(execution.result.message, /body is required/);
});

test("rejects a missing or malformed evidence digest before invoking the service", () => {
  const execution = runResource({
    body: { dataString: "{}" },
    pathParams: { change_sys_id: "0123456789abcdef0123456789abcdef" },
    evidenceSha256: "bad",
  });
  assert.deepEqual(execution.statuses, [400]);
  assert.equal(execution.calls.length, 0);
  assert.match(execution.result.message, /SHA256 header is required/);
});

test("preserves client status codes but hides internal failure details", () => {
  const conflict = new Error("change identity conflict");
  conflict.statusCode = 409;
  const rejected = runResource({
    body: { dataString: "{}" },
    pathParams: { change_sys_id: "0123456789abcdef0123456789abcdef" },
    serviceError: conflict,
  });
  assert.deepEqual(rejected.statuses, [409]);
  assert.equal(rejected.result.message, "change identity conflict");

  const failed = runResource({
    body: { dataString: "{}" },
    pathParams: { change_sys_id: "0123456789abcdef0123456789abcdef" },
    serviceError: new Error("database internals must not leak"),
  });
  assert.deepEqual(failed.statuses, [500]);
  assert.equal(failed.result.message, "change assurance ingestion failed");
});
