import {
    BooleanColumn,
    DateTimeColumn,
    IntegerColumn,
    ReferenceColumn,
    StringColumn,
    Table,
} from '@servicenow/sdk/core'

export const __SCOPE___assurance = Table({
    name: '__SCOPE___assurance',
    label: 'Forward Change Assurance',
    extends: 'task',
    audit: true,
    allowWebServiceAccess: false,
    accessibleFrom: 'package_private',
    schema: {
        change_request: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', mandatory: true }),
        run_id: StringColumn({ label: 'Assurance Run ID', maxLength: 255 }),
        idempotency_key: StringColumn({ label: 'Idempotency Key', maxLength: 128, mandatory: true, unique: true }),
        deployment_id: StringColumn({ label: 'Deployment ID', maxLength: 255, mandatory: true }),
        service_entity_ids: StringColumn({ label: 'Dynatrace Service Entity IDs', maxLength: 4000 }),
        lifecycle_state: StringColumn({
            label: 'Lifecycle State',
            default: 'received',
            choices: {
                received: 'Received',
                baseline_pending: 'Baseline pending',
                baseline_captured: 'Baseline captured',
                waiting: 'Waiting for completion',
                evidence_received: 'Evidence received',
                complete: 'Complete',
                error: 'Error',
            },
        }),
        decision: StringColumn({ label: 'Gate Decision', choices: { pass: 'Pass', warn: 'Warn', fail: 'Fail' } }),
        reason_codes: StringColumn({ label: 'Reason Codes', maxLength: 4000 }),
        forward_network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
        before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
        after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
        reconciliation_run_id: StringColumn({ label: 'Reconciliation Run ID', maxLength: 255 }),
        reconciliation_state: StringColumn({ label: 'Reconciliation State', maxLength: 64 }),
        dynatrace_deployment_state: StringColumn({ label: 'Dynatrace Deployment State', maxLength: 64 }),
        dynatrace_service_health: StringColumn({ label: 'Dynatrace Service Health', maxLength: 64 }),
        dynatrace_open_problem_count: IntegerColumn({ label: 'Dynatrace Open Problem Count', min: 0 }),
        preflight_sha256: StringColumn({ label: 'Preflight SHA-256', maxLength: 64 }),
        gate_sha256: StringColumn({ label: 'Gate SHA-256', maxLength: 64 }),
        evidence_sha256: StringColumn({ label: 'Evidence SHA-256', maxLength: 64 }),
        generated_at: DateTimeColumn({ label: 'Evidence Generated At' }),
        attachment: ReferenceColumn({ label: 'Evidence Attachment', referenceTable: 'sys_attachment' }),
        work_note_marker: StringColumn({ label: 'Work Note Marker', maxLength: 128 }),
        publication_status: StringColumn({
            label: 'Publication Status',
            default: 'pending',
            choices: {
                pending: 'Pending',
                attachment_ready: 'Attachment ready',
                published: 'Published',
                error: 'Error',
            },
        }),
        publication_error: StringColumn({ label: 'Publication Error', maxLength: 4000 }),
    },
    autoNumber: { prefix: 'FCA', number: 1, numberOfDigits: 7 },
})

export const __SCOPE___validation = Table({
    name: '__SCOPE___validation',
    label: 'Forward Path Validation',
    extends: 'task',
    audit: true,
    allowWebServiceAccess: false,
    accessibleFrom: 'package_private',
    schema: {
        change_request: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', mandatory: true }),
        source_ip: StringColumn({ label: 'Source IP', maxLength: 45, mandatory: true }),
        destination_ip: StringColumn({ label: 'Destination IP', maxLength: 45, mandatory: true }),
        protocol: StringColumn({ label: 'Protocol', default: 'TCP', choices: { TCP: 'TCP', UDP: 'UDP' } }),
        destination_port: IntegerColumn({ label: 'Destination Port', min: 1, max: 65535 }),
        expected_outcome: StringColumn({ label: 'Expected Outcome', choices: { allowed: 'Allowed', blocked: 'Blocked' } }),
        validation_status: StringColumn({
            label: 'Validation Status',
            default: 'not_run',
            choices: { not_run: 'Not run', pass: 'Pass', fail: 'Fail', error: 'Error' },
        }),
        forward_network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
        forward_snapshot_id: StringColumn({ label: 'Forward Snapshot ID', maxLength: 255 }),
        observed_outcome: StringColumn({ label: 'Observed Outcome', choices: { allowed: 'Allowed', blocked: 'Blocked' } }),
        evidence_summary: StringColumn({ label: 'Evidence Summary', maxLength: 4000 }),
    },
    autoNumber: { prefix: 'FPV', number: 1, numberOfDigits: 7 },
})

export const __SCOPE___predict_proposal = Table({
    name: '__SCOPE___predict_proposal',
    label: 'Forward Predict Proposal',
    // Proposed commands can hold keys and SNMP communities: no audit, history, journal or web service access.
    audit: false,
    allowWebServiceAccess: false,
    accessibleFrom: 'package_private',
    schema: {
        change: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', mandatory: true, cascadeRule: 'delete' }),
        device_name: StringColumn({ label: 'Forward Device Name', maxLength: 128, mandatory: true }),
        commands: StringColumn({ label: 'Proposed CLI Commands', maxLength: 60000, mandatory: true, attributes: { no_audit: true } }),
    },
})

export const __SCOPE___predict_run = Table({
    name: '__SCOPE___predict_run',
    label: 'Forward Predict Run',
    audit: false,
    allowWebServiceAccess: false,
    accessibleFrom: 'package_private',
    schema: {
        // cascadeRule none: a deleted change must not take the change-set ids with it before cleanup has used them.
        change: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', cascadeRule: 'none' }),
        // The change sys_id while the run is active, the run's own sys_id once it ends. Unique, so only one run is active.
        claim: StringColumn({ label: 'Active Claim', maxLength: 32, unique: true, mandatory: true }),
        outcome: StringColumn({
            label: 'Outcome',
            default: 'starting',
            choices: { starting: 'Starting', pending: 'Pending', answered: 'Answered', failed: 'Failed' },
        }),
        cleanup: StringColumn({ label: 'Cleanup', default: 'open', choices: { open: 'Open', cleaned: 'Cleaned' } }),
        change_set_id: StringColumn({ label: 'Forward Change Set ID', maxLength: 64 }),
        predicted_snapshot_id: StringColumn({ label: 'Predicted Snapshot ID', maxLength: 64 }),
        network_id: StringColumn({ label: 'Forward Network ID', maxLength: 64 }),
        started_ms: StringColumn({ label: 'Started (epoch ms)', maxLength: 20 }),
        revision: IntegerColumn({ label: 'Proposal Revision' }),
        detail: StringColumn({ label: 'Detail', maxLength: 200 }),
    },
})

export const __SCOPE___criterion = Table({
    name: '__SCOPE___criterion',
    label: 'Forward Validation Criterion',
    audit: true,
    allowWebServiceAccess: false,
    accessibleFrom: 'package_private',
    schema: {
        change: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', mandatory: true, cascadeRule: 'delete' }),
        name: StringColumn({ label: 'Name', maxLength: 128, mandatory: true }),
        query_path: StringColumn({ label: 'Forward Query Path', maxLength: 512, mandatory: true }),
        expectation: StringColumn({
            label: 'Expectation',
            default: 'no_rows',
            choices: { no_rows: 'No rows', some_rows: 'Some rows', no_diff: 'Same rows as the baseline' },
        }),
        severity: StringColumn({
            label: 'Severity',
            default: 'error',
            choices: { info: 'Info', warning: 'Warning', error: 'Error', critical: 'Critical' },
        }),
        active: BooleanColumn({ label: 'Active', default: true }),
        // Set by Bind only; a user cannot write them (see the field ACLs).
        query_id: StringColumn({ label: 'Pinned Query ID', maxLength: 64 }),
        commit_id: StringColumn({ label: 'Pinned Commit ID', maxLength: 64 }),
        binding_note: StringColumn({ label: 'Binding Note', maxLength: 200 }),
    },
})

export const __SCOPE___validation_run = Table({
    name: '__SCOPE___validation_run',
    label: 'Forward Validation Run',
    audit: false,
    allowWebServiceAccess: false,
    accessibleFrom: 'package_private',
    schema: {
        change: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', cascadeRule: 'delete' }),
        // The change sys_id while the run is active, the run's own sys_id once it ends. Unique: one active run per change.
        claim: StringColumn({ label: 'Active Claim', maxLength: 32, unique: true, mandatory: true }),
        outcome: StringColumn({
            label: 'Outcome',
            default: 'running',
            choices: { running: 'Running', complete: 'Complete', error: 'Error' },
        }),
        score: IntegerColumn({ label: 'Score' }),
        revision: IntegerColumn({ label: 'Criteria Revision' }),
        snapshot_id: StringColumn({ label: 'Forward Snapshot ID', maxLength: 64 }),
        baseline_snapshot_id: StringColumn({ label: 'Baseline Snapshot ID', maxLength: 64 }),
        passed: IntegerColumn({ label: 'Passed' }),
        failed: IntegerColumn({ label: 'Failed' }),
        errored: IntegerColumn({ label: 'Errored' }),
        skipped: IntegerColumn({ label: 'Skipped' }),
        started_ms: StringColumn({ label: 'Started (epoch ms)', maxLength: 20 }),
        detail: StringColumn({ label: 'Detail', maxLength: 200 }),
    },
})

export const __SCOPE___validation_result = Table({
    name: '__SCOPE___validation_result',
    label: 'Forward Validation Result',
    audit: false,
    allowWebServiceAccess: false,
    accessibleFrom: 'package_private',
    schema: {
        run: ReferenceColumn({ label: 'Validation Run', referenceTable: '__SCOPE___validation_run', mandatory: true, cascadeRule: 'delete' }),
        criterion: ReferenceColumn({ label: 'Criterion', referenceTable: '__SCOPE___criterion', cascadeRule: 'clear' }),
        // The version that was actually run, kept even if the criterion is re-pinned or deleted later.
        query_id: StringColumn({ label: 'Query ID Run', maxLength: 64 }),
        commit_id: StringColumn({ label: 'Commit ID Run', maxLength: 64 }),
        status: StringColumn({ label: 'Status', choices: { pass: 'Pass', fail: 'Fail', error: 'Error', skipped: 'Skipped' } }),
        row_count: IntegerColumn({ label: 'Row Count' }),
        detail: StringColumn({ label: 'Detail', maxLength: 200 }),
    },
})

export const change_request = Table({
    augments: 'change_request',
    schema: {
        __SCOPE___assurance_run_id: StringColumn({ label: 'Forward Assurance Run ID', maxLength: 64 }),
        __SCOPE___assurance_status: StringColumn({
            label: 'Forward Assurance Status',
            default: 'not_started',
            choices: {
                not_started: 'Not started',
                start_queued: 'Start queued',
                start_running: 'Start running',
                baseline_captured: 'Baseline captured',
                complete_queued: 'Complete queued',
                complete_running: 'Complete running',
                completed: 'Completed',
                blocked: 'Blocked',
                failed: 'Failed',
            },
        }),
        __SCOPE___validation_status: StringColumn({
            label: 'Forward Validation Status',
            default: 'not_run',
            // incomplete: nothing failed but a criterion was skipped. stale: criteria changed after the run.
            choices: { not_run: 'Not run', pass: 'Pass', fail: 'Fail', error: 'Error', incomplete: 'Incomplete', stale: 'Stale' },
        }),
        // Blank when nothing was measured; the status is the field to act on.
        __SCOPE___validation_score: IntegerColumn({ label: 'Forward Validation Score' }),
        __SCOPE___validation_snapshot_id: StringColumn({ label: 'Forward Validation Snapshot ID', maxLength: 64 }),
        __SCOPE___criteria_revision: IntegerColumn({ label: 'Forward Criteria Revision', default: 0 }),
        __SCOPE___predict_revision: IntegerColumn({ label: 'Forward Predict Proposal Revision', default: 0 }),
        __SCOPE___assurance_decision: StringColumn({
            label: 'Forward Assurance Decision',
            default: 'pending',
            choices: { pending: 'Pending', pass: 'Pass', warn: 'Warn', fail: 'Fail' },
        }),
    },
})
