const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

global.GlideDigest = class GlideDigest {
  getSHA256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
  }
};

const ChangeAssuranceContract = require("../servicenow/assets/ChangeAssuranceContract.js");

const hash = (character) => character.repeat(64);
const canonicalHash = (value) => createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex");

const fixture = (overrides = {}) => {
  const serviceEntityIds = ["SERVICE-CHECKOUT", "SERVICE-PAYMENTS"];
  const preflight = {
    schemaVersion: "forward-dynatrace-servicenow-change-preflight/v1",
    observedAt: "2026-07-15T18:00:00.000Z",
    mode: "read-only",
    source: {
      instanceAlias: "servicenow-production",
      table: "change_request",
      authoritativeRead: true,
    },
    change: {
      number: "CHG0042187",
      sysId: "0123456789abcdef0123456789abcdef",
      deploymentId: "checkout-api-2026.07.15.3",
      approval: { value: "approved", display: "Approved" },
      state: { value: "scheduled", display: "Scheduled" },
      risk: { value: "3", display: "Moderate" },
      assignmentGroup: { value: "network", display: "Network" },
      window: {
        startsAt: "2026-07-15T18:30:00.000Z",
        endsAt: "2026-07-15T20:00:00.000Z",
      },
    },
    scope: { forwardNetworkId: "network-production", serviceEntityIds },
    authorization: {
      status: "eligible",
      reasons: [],
      eligibleStateValues: ["scheduled"],
      approvedValues: ["approved"],
    },
    nextStages: ["dynatrace-baseline", "forward-before-evidence", "customer-deployment"],
  };
  const gateEvidence = {
    contextSha256: hash("c"),
    beforePathEvidenceSha256: hash("d"),
    afterPathEvidenceSha256: hash("e"),
    reconciliationStatusSha256: hash("f"),
  };
  const gate = {
    schemaVersion: "forward-dynatrace-change-validation/v1",
    generatedAt: "2026-07-15T19:00:00.000Z",
    change: {
      changeId: "CHG0042187",
      deploymentId: "checkout-api-2026.07.15.3",
      serviceEntityIds,
    },
    decision: "pass",
    reasons: [{ severity: "info", code: "ALL_VALIDATIONS_PASSED", message: "All checks passed." }],
    dynatrace: {
      deploymentState: "SUCCEEDED",
      serviceHealth: "HEALTHY",
      openProblemCount: 0,
    },
    forward: {
      networkId: "network-production",
      before: {
        snapshotId: "snapshot-before",
        status: "complete",
        assessment: "reachable",
        counts: { total: 2, queryable: 2, reachable: 2, blocked: 0, ambiguous: 0, unmapped: 0, failed: 0 },
      },
      after: {
        snapshotId: "snapshot-after",
        status: "complete",
        assessment: "reachable",
        counts: { total: 2, queryable: 2, reachable: 2, blocked: 0, ambiguous: 0, unmapped: 0, failed: 0 },
      },
      delta: { reachable: 0, blocked: 0, ambiguous: 0, unmapped: 0, failed: 0 },
      reconciliation: {
        runId: "reconcile-1",
        packageId: "package-1",
        importState: "reconciled",
        target: { networkId: "network-production", snapshotId: "snapshot-after" },
        plannedChecks: 2,
        counts: { create: 0, unchanged: 2, changed: 0, stale: 0 },
        unresolvedCounts: { changed: 0, stale: 0 },
      },
    },
    evidence: gateEvidence,
  };
  const evidence = {
    schemaVersion: "forward-dynatrace-servicenow-change-assurance-evidence/v1",
    generatedAt: "2026-07-15T19:00:00.000Z",
    change: {
      number: "CHG0042187",
      sysId: "0123456789abcdef0123456789abcdef",
      deploymentId: "checkout-api-2026.07.15.3",
      serviceEntityIds,
    },
    decision: "pass",
    reasonCodes: ["ALL_VALIDATIONS_PASSED"],
    forward: {
      networkId: "network-production",
      beforeSnapshotId: "snapshot-before",
      afterSnapshotId: "snapshot-after",
      reconciliationRunId: "reconcile-1",
      reconciliationState: "reconciled",
    },
    dynatrace: {
      deploymentState: "SUCCEEDED",
      serviceHealth: "HEALTHY",
      openProblemCount: 0,
    },
    lineage: {
      preflightSha256: canonicalHash(preflight),
      gateSha256: canonicalHash(gate),
      gateEvidence: { ...gateEvidence },
    },
    preflight,
    gate,
  };
  return Object.assign(evidence, overrides);
};

test("normalizes an aligned bounded assurance evidence bundle", () => {
  const contract = new ChangeAssuranceContract();
  const parsed = contract.parse(JSON.stringify(fixture()));
  assert.equal(parsed.evidence.changeNumber, "CHG0042187");
  assert.equal(parsed.evidence.decision, "pass");
  assert.deepEqual(parsed.evidence.serviceEntityIds, ["SERVICE-CHECKOUT", "SERVICE-PAYMENTS"]);
  assert.equal(parsed.evidence.beforeSnapshotId, "snapshot-before");
  assert.equal(parsed.evidence.afterSnapshotId, "snapshot-after");
  assert.equal(parsed.evidence.gateSha256, canonicalHash(fixture().gate));
});

test("rejects copied or mismatched change, scope, and gate evidence", () => {
  const contract = new ChangeAssuranceContract();
  const mismatchedChange = fixture();
  mismatchedChange.preflight.change.number = "CHG9999999";
  assert.throws(() => contract.parse(mismatchedChange), /preflight change identity/);

  const mismatchedScope = fixture();
  mismatchedScope.gate.change.serviceEntityIds = ["SERVICE-CHECKOUT"];
  assert.throws(() => contract.parse(mismatchedScope), /gate service scope/);

  const mismatchedSnapshot = fixture();
  mismatchedSnapshot.gate.forward.after.snapshotId = "other-snapshot";
  assert.throws(() => contract.parse(mismatchedSnapshot), /gate Forward target/);
});

test("rejects stale approval shape, same snapshots, duplicate services, and invalid hashes", () => {
  const contract = new ChangeAssuranceContract();
  const blocked = fixture();
  blocked.preflight.authorization.status = "blocked";
  assert.throws(() => contract.parse(blocked), /preflight must be eligible/);

  const sameSnapshot = fixture();
  sameSnapshot.forward.afterSnapshotId = "snapshot-before";
  assert.throws(() => contract.parse(sameSnapshot), /snapshots must differ/);

  const duplicateServices = fixture();
  duplicateServices.change.serviceEntityIds = ["SERVICE-CHECKOUT", "SERVICE-CHECKOUT"];
  assert.throws(() => contract.parse(duplicateServices), /unique values/);

  const badHash = fixture();
  badHash.lineage.gateSha256 = "not-a-hash";
  assert.throws(() => contract.parse(badHash), /lowercase SHA-256/);
});

test("rejects fabricated lineage and mismatched summarized gate fields", () => {
  const contract = new ChangeAssuranceContract();

  const fabricatedPreflightHash = fixture();
  fabricatedPreflightHash.lineage.preflightSha256 = hash("0");
  assert.throws(() => contract.parse(fabricatedPreflightHash), /preflight SHA-256 does not match/);

  const fabricatedGateHash = fixture();
  fabricatedGateHash.lineage.gateSha256 = hash("0");
  assert.throws(() => contract.parse(fabricatedGateHash), /gate SHA-256 does not match/);

  const mismatchedReasons = fixture();
  mismatchedReasons.gate.reasons = [{
    severity: "fail",
    code: "MODELED_REACHABILITY_REGRESSED",
    message: "Reachability regressed.",
  }];
  assert.throws(() => contract.parse(mismatchedReasons), /gate reason codes/);

  const mismatchedReconciliation = fixture();
  mismatchedReconciliation.gate.forward.reconciliation.importState = "changed";
  assert.throws(() => contract.parse(mismatchedReconciliation), /gate reconciliation/);

  const mismatchedDynatrace = fixture();
  mismatchedDynatrace.gate.dynatrace.serviceHealth = "UNHEALTHY";
  assert.throws(() => contract.parse(mismatchedDynatrace), /Dynatrace summary/);

  const mismatchedEvidence = fixture();
  mismatchedEvidence.gate.evidence.contextSha256 = hash("9");
  assert.throws(() => contract.parse(mismatchedEvidence), /gate evidence hashes/);

  const stalePreflightSchema = fixture();
  stalePreflightSchema.preflight.schemaVersion = "legacy/v0";
  assert.throws(() => contract.parse(stalePreflightSchema), /preflight schemaVersion/);

  const staleGateSchema = fixture();
  staleGateSchema.gate.schemaVersion = "legacy/v0";
  assert.throws(() => contract.parse(staleGateSchema), /gate schemaVersion/);

  const mismatchedGeneratedAt = fixture();
  mismatchedGeneratedAt.gate.generatedAt = "2026-07-15T19:01:00.000Z";
  assert.throws(() => contract.parse(mismatchedGeneratedAt), /gate generatedAt/);
});

test("rejects topology rows, raw secrets, credential strings, and oversized payloads", () => {
  const contract = new ChangeAssuranceContract();
  const topology = fixture({ rows: [{ device: "leaf-1" }] });
  assert.throws(() => contract.parse(topology), /forbidden field: rows/);

  const secret = fixture({ password: "do-not-store" });
  assert.throws(() => contract.parse(secret), /forbidden field: password/);

  const mixedCaseSecret = fixture({ Token: "short-but-forbidden" });
  assert.throws(() => contract.parse(mixedCaseSecret), /forbidden field: Token/);

  const bearer = fixture({ note: "Bearer abc.def.ghi" });
  assert.throws(() => contract.parse(bearer), /credential-shaped content/);

  assert.throws(() => contract.parse(JSON.stringify(fixture()), 100), /payload size is invalid/);

  const unicode = JSON.stringify(fixture({ label: "customer-🙂" }));
  assert.ok(Buffer.byteLength(unicode, "utf8") > unicode.length);
  assert.throws(() => contract.parse(unicode, unicode.length), /payload size is invalid/);
});

test("rejects values that cannot fit the persisted ServiceNow fields", () => {
  const contract = new ChangeAssuranceContract();

  const deployment = fixture();
  deployment.change.deploymentId = "d".repeat(256);
  assert.throws(() => contract.parse(deployment), /change.deploymentId exceeds 255 characters/);

  const services = fixture();
  services.change.serviceEntityIds = Array.from({ length: 101 }, (_value, index) => `SERVICE-${index}`);
  assert.throws(() => contract.parse(services), /between 1 and 100 values/);

  const problemCount = fixture();
  problemCount.dynatrace.openProblemCount = 2147483648;
  assert.throws(() => contract.parse(problemCount), /non-negative integer/);
});

test("rejects partial or extended embedded contract documents", () => {
  const contract = new ChangeAssuranceContract();

  const extra = fixture();
  extra.preflight.source.unexpected = "not in the schema";
  assert.throws(() => contract.parse(extra), /preflight source contains unsupported field: unexpected/);

  const partial = fixture();
  delete partial.gate.forward.reconciliation.counts;
  assert.throws(() => contract.parse(partial), /reconciliation counts must be an object/);
});

test("builds a bounded deterministic Change Request work note", () => {
  const contract = new ChangeAssuranceContract();
  const normalized = contract.parse(fixture()).evidence;
  const note = contract.workNote(normalized, hash("9"), "FCA0001001");
  assert.match(note, /Forward\/Dynatrace change assurance: PASS/);
  assert.match(note, /snapshot-before -> snapshot-after/);
  assert.match(note, /Assurance record: FCA0001001/);
  assert.match(note, new RegExp(`\\[forward-dynatrace:${hash("9")}\\]`));
  assert.equal(note.includes("leaf-1"), false);
});
