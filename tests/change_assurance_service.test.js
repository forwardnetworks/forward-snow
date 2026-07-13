const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../servicenow/assets/ChangeAssuranceService.js"),
  "utf8"
);

const loadService = (payloadText, globals = {}) => {
  const normalized = {
    changeSysId: "0123456789abcdef0123456789abcdef",
    changeNumber: "CHG0042187",
  };
  const context = {
    Class: {
      create: () => function ServiceNowClass() {
        if (typeof this.initialize === "function") this.initialize();
      },
    },
    ChangeAssuranceContract: function ChangeAssuranceContract() {
      this.parse = () => ({ text: payloadText, evidence: normalized });
      this.workNote = () => "bounded work note";
    },
    GlideDigest: function GlideDigest() {
      this.getSHA256Hex = (value) => createHash("sha256").update(value).digest("hex");
    },
    gs: { getProperty: (_name, fallback) => fallback },
    module: { exports: {} },
    ...globals,
  };
  vm.runInNewContext(source, context);
  return context.module.exports;
};

test("rejects a digest header that does not match the exact request body", () => {
  const payloadText = '{"schemaVersion":"evidence/v1"}\n';
  const ChangeAssuranceService = loadService(payloadText);
  const service = new ChangeAssuranceService();
  service._loadChange = () => ({ getUniqueValue: () => "0123456789abcdef0123456789abcdef" });

  assert.throws(
    () => service.ingest(
      "0123456789abcdef0123456789abcdef",
      payloadText,
      "0".repeat(64)
    ),
    /SHA-256 header does not match request body/
  );
  try {
    service.ingest(
      "0123456789abcdef0123456789abcdef",
      payloadText,
      "0".repeat(64)
    );
    assert.fail("expected digest mismatch");
  } catch (error) {
    assert.equal(error.statusCode, 400);
  }
});

test("publishes attachment before work note and reuses both identifiers on retry", () => {
  const events = [];
  let attachmentSysId = "";
  let workNoteSysId = "";
  const ChangeAssuranceService = loadService("{}", {
    GlideSysAttachment: function GlideSysAttachment() {
      this.write = () => {
        events.push("attachment:write");
        attachmentSysId = "attachment-sys-id";
        return attachmentSysId;
      };
    },
  });
  const service = new ChangeAssuranceService();
  service._existingAttachment = () => attachmentSysId;
  service._workNoteSysId = () => workNoteSysId;

  const fields = { u_publication_error: "previous failure" };
  const record = {
    number: "FCA0001001",
    getUniqueValue: () => "ledger-sys-id",
    isValidField: () => true,
    setValue: (field, value) => { fields[field] = String(value); },
    getValue: (field) => fields[field] || "",
    update: () => { events.push(`ledger:${fields.u_publication_status}`); },
  };
  const change = {
    getUniqueValue: () => "change-sys-id",
    update: () => {
      events.push("work-note:write");
      workNoteSysId = "work-note-sys-id";
    },
  };
  const value = {};
  const digest = "a".repeat(64);
  const key = `forward-dynatrace:${digest}`;

  const first = service._ensurePublication(record, change, value, "{}", digest, key);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), {
    workNote: { status: "created", sysId: "work-note-sys-id" },
    attachment: { status: "created", sysId: "attachment-sys-id" },
  });
  assert.ok(events.indexOf("attachment:write") < events.indexOf("ledger:attachment_ready"));
  assert.ok(events.indexOf("ledger:attachment_ready") < events.indexOf("work-note:write"));
  assert.equal(fields.u_publication_status, "published");
  assert.equal(fields.u_publication_error, "");

  const writesBeforeRetry = events.filter((event) => event.endsWith(":write")).length;
  const second = service._ensurePublication(record, change, value, "{}", digest, key);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), {
    workNote: { status: "existing", sysId: "work-note-sys-id" },
    attachment: { status: "existing", sysId: "attachment-sys-id" },
  });
  assert.equal(events.filter((event) => event.endsWith(":write")).length, writesBeforeRetry);
});
