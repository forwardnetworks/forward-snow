var ChangeAssuranceMigration = Class.create();
ChangeAssuranceMigration.prototype = {
  initialize: function () {},

  plan: function () {
    return this.execute({ dryRun: true, includeChangeRequests: false, limit: 1000 });
  },

  execute: function (options) {
    this._requireAdmin();
    options = options || {};
    var dryRun = options.dryRun !== false;
    var limit = parseInt(options.limit || 1000, 10);
    if (!isFinite(limit) || limit < 1 || limit > 5000) throw new Error('migration limit must be between 1 and 5000');

    var report = {
      schemaVersion: 'forward-change-assurance-migration-report/v1',
      scope: '__SCOPE__',
      dryRun: dryRun,
      credentialValuesCopied: false,
      legacyRecordsDeleted: false,
      concurrentWritersAllowed: false,
      assurance: this._copyAssurance(dryRun, limit),
      validation: this._copyValidation(dryRun, limit),
      properties: this._copyBoundedProperties(dryRun),
      changeRequests: { status: 'not_requested', planned: 0, copied: 0, skipped: 0 },
    };
    if (options.includeChangeRequests === true) report.changeRequests = this._copyChangeRequests(dryRun, limit);
    return report;
  },

  _copyAssurance: function (dryRun, limit) {
    return this._copyTable({
      source: 'u_forward_change_assurance', target: '__SCOPE___assurance', dryRun: dryRun, limit: limit,
      required: ['u_change_request'], defaults: { idempotency_key: 'legacy:{sys_id}', deployment_id: 'legacy-import' },
      fields: [
        'change_request', 'run_id', 'idempotency_key', 'deployment_id', 'service_entity_ids', 'lifecycle_state',
        'decision', 'reason_codes', 'forward_network_id', 'before_snapshot_id', 'after_snapshot_id',
        'reconciliation_run_id', 'reconciliation_state', 'dynatrace_deployment_state', 'dynatrace_service_health',
        'dynatrace_open_problem_count', 'preflight_sha256', 'gate_sha256', 'evidence_sha256', 'generated_at',
        'attachment', 'work_note_marker', 'publication_status', 'publication_error',
      ],
    });
  },

  _copyValidation: function (dryRun, limit) {
    return this._copyTable({
      source: 'u_forward_change_validation', target: '__SCOPE___validation', dryRun: dryRun, limit: limit,
      required: ['u_change_request', 'u_source_ip', 'u_destination_ip'], defaults: {},
      fields: [
        'change_request', 'source_ip', 'destination_ip', 'protocol', 'destination_port', 'expected_outcome',
        'validation_status', 'forward_network_id', 'forward_snapshot_id', 'observed_outcome', 'evidence_summary',
      ],
    });
  },

  _copyTable: function (config) {
    var report = { source: config.source, target: config.target, status: 'ready', scanned: 0, planned: 0, copied: 0, existing: 0, skipped: 0, errors: [] };
    var source = new GlideRecord(config.source);
    var targetProbe = new GlideRecord(config.target);
    if (!source.isValid()) { report.status = 'source_absent'; return report; }
    if (!targetProbe.isValid()) throw new Error('migration target table is unavailable: ' + config.target);
    source.orderBy('sys_id');
    source.setLimit(config.limit);
    source.query();
    while (source.next()) {
      report.scanned += 1;
      var sourceId = String(source.getUniqueValue() || '');
      var existing = new GlideRecord(config.target);
      existing.addQuery('legacy_source_sys_id', sourceId);
      existing.setLimit(1);
      existing.query();
      if (existing.next()) { report.existing += 1; continue; }
      if (!this._hasRequired(source, config.required)) {
        report.skipped += 1;
        report.errors.push({ sourceSysId: sourceId, code: 'MISSING_REQUIRED_SOURCE_FIELD' });
        continue;
      }
      report.planned += 1;
      if (config.dryRun) continue;
      var target = new GlideRecord(config.target);
      target.initialize();
      target.setValue('legacy_source_sys_id', sourceId);
      for (var index = 0; index < config.fields.length; index += 1) {
        var targetField = config.fields[index];
        var sourceField = 'u_' + targetField;
        if (target.isValidField(targetField) && source.isValidField(sourceField)) {
          var value = String(source.getValue(sourceField) || '');
          if (value) target.setValue(targetField, value);
        }
      }
      for (var defaultField in config.defaults) {
        if (!config.defaults.hasOwnProperty(defaultField) || String(target.getValue(defaultField) || '')) continue;
        target.setValue(defaultField, String(config.defaults[defaultField]).replace('{sys_id}', sourceId));
      }
      if (target.isValidField('short_description')) target.setValue('short_description', 'Migrated Forward assurance evidence ' + sourceId);
      var inserted = String(target.insert() || '');
      if (!inserted) { report.errors.push({ sourceSysId: sourceId, code: 'INSERT_FAILED' }); continue; }
      report.copied += 1;
    }
    if (report.errors.length) report.status = 'completed_with_skips';
    return report;
  },

  _copyChangeRequests: function (dryRun, limit) {
    var report = { status: 'ready', planned: 0, copied: 0, skipped: 0 };
    var changes = new GlideRecord('change_request');
    changes.addEncodedQuery('u_forward_assurance_run_idISNOTEMPTY^ORu_forward_assurance_statusISNOTEMPTY^ORu_forward_assurance_decisionISNOTEMPTY');
    changes.orderBy('sys_id');
    changes.setLimit(limit);
    changes.query();
    while (changes.next()) {
      report.planned += 1;
      if (dryRun) continue;
      var mappings = {
        u_forward_assurance_run_id: '__SCOPE___assurance_run_id',
        u_forward_assurance_status: '__SCOPE___assurance_status',
        u_forward_assurance_decision: '__SCOPE___assurance_decision',
      };
      for (var sourceField in mappings) {
        if (mappings.hasOwnProperty(sourceField) && changes.isValidField(sourceField) && changes.isValidField(mappings[sourceField])) {
          var value = String(changes.getValue(sourceField) || '');
          if (value) changes.setValue(mappings[sourceField], value);
        }
      }
      changes.setWorkflow(false);
      changes.autoSysFields(false);
      if (changes.update()) report.copied += 1; else report.skipped += 1;
    }
    return report;
  },

  _copyBoundedProperties: function (dryRun) {
    var definitions = [
      { source: 'x_fwd_demo.assurance.max_payload_bytes', target: '__SCOPE__.assurance.max_payload_bytes', min: 1024, max: 1048576 },
      { source: 'x_fwd_demo.assurance.worker_timeout_ms', target: '__SCOPE__.assurance.worker_timeout_ms', min: 1000, max: 120000 },
      { source: 'x_fwd_demo.assurance.worker_max_payload_bytes', target: '__SCOPE__.assurance.worker_max_payload_bytes', min: 16384, max: 1048576 },
    ];
    var report = { planned: 0, copied: 0, skipped: 0 };
    for (var index = 0; index < definitions.length; index += 1) {
      var definition = definitions[index];
      var raw = String(gs.getProperty(definition.source, '') || '');
      var parsed = parseInt(raw, 10);
      if (!raw || !isFinite(parsed) || parsed < definition.min || parsed > definition.max) { report.skipped += 1; continue; }
      report.planned += 1;
      if (!dryRun) { gs.setProperty(definition.target, String(parsed)); report.copied += 1; }
    }
    return report;
  },

  _hasRequired: function (record, fields) {
    for (var index = 0; index < fields.length; index += 1) {
      if (!record.isValidField(fields[index]) || !String(record.getValue(fields[index]) || '')) return false;
    }
    return true;
  },

  _requireAdmin: function () {
    if (!gs.hasRole('__SCOPE__.admin')) throw new Error('Forward Change Assurance administrator role is required');
  },

  type: 'ChangeAssuranceMigration',
};
