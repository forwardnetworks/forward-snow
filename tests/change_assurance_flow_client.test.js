const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../servicenow/assets/ChangeAssuranceFlowClient.js"),
  "utf8"
);

const runBody = ({
  runId = "fdca-" + "b".repeat(24),
  status = "start-queued",
  phase = status === "completed" ? "complete" : "start",
  decision = null,
} = {}) => ({
  schemaVersion: "forward-dynatrace-servicenow-flow-run/v1",
  runId,
  status,
  phase,
  createdAt: "2026-07-15T18:00:00.000Z",
  updatedAt: "2026-07-15T18:01:00.000Z",
  change: {
    number: "CHG0042187",
    deploymentId: "deployment-1",
    serviceEntityIds: ["SERVICE-1"],
  },
  scopeMapping: null,
  forward: {
    networkId: "network-1",
    beforeSnapshotId: "snapshot-before",
    afterSnapshotId: status === "completed" ? "snapshot-after" : null,
  },
  decision,
  exitCode: status === "completed" ? 0 : null,
  error: null,
});

const loadClient = ({ propertyOverrides = {}, responses = [] } = {}) => {
  const properties = {
    "x_fwd_demo.assurance.worker_base_url": "https://worker.example.com",
    "x_fwd_demo.assurance.worker_allowed_base_urls": "https://worker.example.com",
    "x_fwd_demo.assurance.worker_auth_profile": "a".repeat(32),
    "x_fwd_demo.assurance.worker_timeout_ms": "30000",
    "x_fwd_demo.assurance.worker_max_payload_bytes": "524288",
    ...propertyOverrides,
  };
  const requests = [];
  const context = {
    Class: {
      create: () => function ServiceNowClass() {
        if (typeof this.initialize === "function") this.initialize();
      },
    },
    gs: { getProperty: (name, fallback) => properties[name] == null ? fallback : properties[name] },
    sn_ws: {
      RESTMessageV2: function RESTMessageV2() {
        const request = { headers: {} };
        requests.push(request);
        this.setHttpMethod = (value) => { request.method = value; };
        this.setEndpoint = (value) => { request.endpoint = value; };
        this.setAuthenticationProfile = (kind, value) => { request.auth = { kind, value }; };
        this.setHttpTimeout = (value) => { request.timeout = value; };
        this.setRequestHeader = (name, value) => { request.headers[name] = value; };
        this.setRequestBody = (value) => { request.body = value; };
        this.execute = () => {
          const response = responses.shift() || {
            status: 202,
            body: JSON.stringify(runBody()),
          };
          return {
            getStatusCode: () => response.status,
            getBody: () => response.body,
          };
        };
      },
    },
    module: { exports: {} },
  };
  vm.runInNewContext(source, context);
  return { Client: context.module.exports, requests };
};

test("calls the purchase-free assurance worker with an auth profile", () => {
  const { Client, requests } = loadClient();
  const client = new Client();
  const result = client.start({
    changeNumber: "CHG0042187",
    deploymentId: "deployment-1",
    affectedRecords: [
      { table: "cmdb_ci_service", sysId: "2".repeat(32) },
      { table: "cmdb_ci", sysId: "1".repeat(32) },
    ],
  });
  assert.equal(result.status, "start-queued");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].endpoint, "https://worker.example.com/v1/servicenow/change-assurance/start");
  assert.deepEqual(requests[0].auth, { kind: "basic", value: "a".repeat(32) });
  assert.equal(requests[0].timeout, 30000);
  assert.deepEqual(JSON.parse(requests[0].body).affectedRecords, [
    { table: "cmdb_ci", sysId: "1".repeat(32) },
    { table: "cmdb_ci_service", sysId: "2".repeat(32) },
  ]);
});

test("supports status and completion while validating worker responses", () => {
  const runId = "fdca-" + "c".repeat(24);
  const response = (status, decision = null) => ({
    status: 200,
    body: JSON.stringify(runBody({
      runId,
      status,
      phase: status === "completed" ? "complete" : "start",
      decision,
    })),
  });
  const { Client, requests } = loadClient({
    responses: [response("baseline-captured"), response("completed", "pass")],
  });
  const client = new Client();
  assert.equal(client.status(runId).status, "baseline-captured");
  assert.equal(client.complete(runId, {
    schemaVersion: "forward-dynatrace-change-context/v1",
    changeId: "CHG0042187",
    deploymentId: "deployment-1",
    observedAt: "2026-07-15T19:00:00.000Z",
    serviceEntityIds: ["SERVICE-1"],
    dynatrace: { deploymentState: "SUCCEEDED", serviceHealth: "HEALTHY", openProblemCount: 0 },
  }).decision, "pass");
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[1].endpoint, `https://worker.example.com/v1/servicenow/change-assurance/runs/${runId}/complete`);
});

test("fails closed for unallowlisted origins, missing auth profiles, and secret-shaped payloads", () => {
  assert.throws(
    () => new (loadClient({
      propertyOverrides: { "x_fwd_demo.assurance.worker_base_url": "http://worker.example.com" },
    }).Client)(),
    /must use https/,
  );
  assert.throws(
    () => new (loadClient({
      propertyOverrides: { "x_fwd_demo.assurance.worker_auth_profile": "" },
    }).Client)(),
    /Auth Profile sys_id is required/,
  );
  const { Client } = loadClient();
  const client = new Client();
  assert.throws(
    () => client.start({
      changeNumber: "CHG0042187",
      deploymentId: "deployment-1",
      affectedRecords: [{ table: "cmdb_ci", sysId: "1".repeat(32) }],
      dependencies: [{ id: "1", token: "do-not-send" }],
    }),
    /forbidden field: token/,
  );
  assert.throws(
    () => client.start({
      changeNumber: "CHG0042187",
      deploymentId: "deployment-1",
      affectedRecords: [{ table: "cmdb_ci", sysId: "1".repeat(32) }],
      dependencies: [{ id: "1", Token: "case-insensitive" }],
    }),
    /forbidden field: Token/,
  );
});

test("rejects invalid payload bounds and incomplete or oversized worker responses", () => {
  assert.throws(
    () => new (loadClient({
      propertyOverrides: { "x_fwd_demo.assurance.worker_max_payload_bytes": "9999999" },
    }).Client)(),
    /payload limit must be between/,
  );

  const incomplete = loadClient({
    responses: [{
      status: 200,
      body: JSON.stringify({
        schemaVersion: "forward-dynatrace-servicenow-flow-run/v1",
        runId: "fdca-" + "d".repeat(24),
        status: "start-queued",
      }),
    }],
  });
  assert.throws(() => new incomplete.Client().status("fdca-" + "d".repeat(24)), /phase is unsupported/);

  const oversized = loadClient({
    propertyOverrides: { "x_fwd_demo.assurance.worker_max_payload_bytes": "16384" },
    responses: [{ status: 200, body: "x".repeat(16385) }],
  });
  assert.throws(() => new oversized.Client().status("fdca-" + "e".repeat(24)), /response payload is too large/);
});
