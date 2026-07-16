const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../servicenow/assets/ChangeAssuranceCloseGuard.js"), "utf8");

const loadGuard = () => {
  const context = {
    Class: { create: () => function ServiceNowClass() {} },
    gs: { getProperty: (_name, fallback) => fallback },
    module: { exports: {} },
  };
  vm.runInNewContext(source, context);
  return context.module.exports;
};

const record = (values, sysId = "a".repeat(32)) => ({
  getUniqueValue: () => sysId,
  isValidField: (field) => Object.hasOwn(values, field),
  getValue: (field) => values[field] || "",
});

test("allows close only with complete published live evidence", () => {
  const Guard = loadGuard();
  const guard = new Guard();
  const change = record({ u_forward_assurance_status: "completed", u_forward_assurance_decision: "pass" });
  guard._latestEvidence = () => record({
    u_lifecycle_state: "complete",
    u_decision: "pass",
    u_publication_status: "published",
    u_reconciliation_state: "reconciled",
    u_dynatrace_service_health: "HEALTHY",
    u_dynatrace_open_problem_count: "0",
    u_before_snapshot_id: "1345993",
    u_after_snapshot_id: "1345995",
    u_preflight_sha256: "a".repeat(64),
    u_gate_sha256: "b".repeat(64),
    u_evidence_sha256: "c".repeat(64),
    u_attachment: "d".repeat(32),
  });
  assert.equal(guard.evaluate(change).allowed, true);
});

test("blocks close when any authoritative gate is incomplete", () => {
  const Guard = loadGuard();
  const guard = new Guard();
  const change = record({ u_forward_assurance_status: "completed", u_forward_assurance_decision: "pass" });
  guard._latestEvidence = () => record({
    u_lifecycle_state: "complete",
    u_decision: "fail",
    u_publication_status: "published",
    u_reconciliation_state: "reconciled",
    u_dynatrace_service_health: "DEGRADED",
    u_dynatrace_open_problem_count: "1",
    u_before_snapshot_id: "same",
    u_after_snapshot_id: "same",
  });
  const result = guard.evaluate(change);
  assert.equal(result.allowed, false);
  assert.ok(result.failures.length >= 6);
});
