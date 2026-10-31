import { Action, actionStep, wfa } from '@servicenow/sdk/automation'
import { BooleanColumn, IntegerColumn, StringColumn } from '@servicenow/sdk/core'

export const startChangeAssurance = Action(
    {
        $id: Now.ID['start_change_assurance_action'],
        name: 'Start Forward Change Assurance',
        internalName: 'start_forward_change_assurance',
        description: 'Start the bounded Forward baseline phase for an authorized Change Request',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        inputs: {
            change_number: StringColumn({ label: 'Change number', mandatory: true, maxLength: 32 }),
            deployment_id: StringColumn({ label: 'Deployment ID', mandatory: true, maxLength: 255 }),
            affected_records_json: StringColumn({ label: 'Affected records JSON', mandatory: true, maxLength: 65535 }),
            instance_alias: StringColumn({ label: 'ServiceNow instance alias', maxLength: 128 }),
            dependencies_json: StringColumn({ label: 'Optional Dynatrace dependencies JSON', maxLength: 65535 }),
            retry: BooleanColumn({ label: 'Retry an unchanged failed start', default: false }),
        },
        outputs: {
            run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
            status: StringColumn({ label: 'Status', maxLength: 64 }),
            phase: StringColumn({ label: 'Phase', maxLength: 32 }),
            decision: StringColumn({ label: 'Decision', maxLength: 16 }),
            network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
            before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
            after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['start_change_assurance_script'], label: 'Call assurance worker start' },
            {
                required_run_time: 'instance',
                script: Now.include('../server/actions/start-change-assurance.server.js'),
                inputVariables: {
                    change_number: { label: 'Change number', value: wfa.dataPill(params.inputs.change_number, 'string') },
                    deployment_id: { label: 'Deployment ID', value: wfa.dataPill(params.inputs.deployment_id, 'string') },
                    affected_records_json: { label: 'Affected records JSON', value: wfa.dataPill(params.inputs.affected_records_json, 'string') },
                    instance_alias: { label: 'Instance alias', value: wfa.dataPill(params.inputs.instance_alias, 'string') },
                    dependencies_json: { label: 'Dependencies JSON', value: wfa.dataPill(params.inputs.dependencies_json, 'string') },
                    retry: { label: 'Retry', value: wfa.dataPill(params.inputs.retry, 'boolean') },
                },
                outputVariables: {
                    run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
                    status: StringColumn({ label: 'Status', maxLength: 64 }),
                    phase: StringColumn({ label: 'Phase', maxLength: 32 }),
                    decision: StringColumn({ label: 'Decision', maxLength: 16 }),
                    network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
                    before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
                    after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
                },
                errorHandlingType: 'stop_the_action',
            },
        )
        wfa.assignActionOutputs(params.outputs, {
            run_id: wfa.dataPill(step.run_id, 'string'),
            status: wfa.dataPill(step.status, 'string'),
            phase: wfa.dataPill(step.phase, 'string'),
            decision: wfa.dataPill(step.decision, 'string'),
            network_id: wfa.dataPill(step.network_id, 'string'),
            before_snapshot_id: wfa.dataPill(step.before_snapshot_id, 'string'),
            after_snapshot_id: wfa.dataPill(step.after_snapshot_id, 'string'),
        })
    },
)

export const getChangeAssuranceStatus = Action(
    {
        $id: Now.ID['get_change_assurance_status_action'],
        name: 'Get Forward Change Assurance Status',
        internalName: 'get_forward_change_assurance_status',
        description: 'Read bounded state for an existing assurance worker run',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        inputs: { run_id: StringColumn({ label: 'Run ID', mandatory: true, maxLength: 64 }) },
        outputs: {
            run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
            status: StringColumn({ label: 'Status', maxLength: 64 }),
            phase: StringColumn({ label: 'Phase', maxLength: 32 }),
            decision: StringColumn({ label: 'Decision', maxLength: 16 }),
            network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
            before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
            after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['get_change_assurance_status_script'], label: 'Read assurance worker status' },
            {
                required_run_time: 'instance',
                script: Now.include('../server/actions/get-change-assurance-status.server.js'),
                inputVariables: { run_id: { label: 'Run ID', value: wfa.dataPill(params.inputs.run_id, 'string') } },
                outputVariables: {
                    run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
                    status: StringColumn({ label: 'Status', maxLength: 64 }),
                    phase: StringColumn({ label: 'Phase', maxLength: 32 }),
                    decision: StringColumn({ label: 'Decision', maxLength: 16 }),
                    network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
                    before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
                    after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
                },
                errorHandlingType: 'stop_the_action',
            },
        )
        wfa.assignActionOutputs(params.outputs, {
            run_id: wfa.dataPill(step.run_id, 'string'),
            status: wfa.dataPill(step.status, 'string'),
            phase: wfa.dataPill(step.phase, 'string'),
            decision: wfa.dataPill(step.decision, 'string'),
            network_id: wfa.dataPill(step.network_id, 'string'),
            before_snapshot_id: wfa.dataPill(step.before_snapshot_id, 'string'),
            after_snapshot_id: wfa.dataPill(step.after_snapshot_id, 'string'),
        })
    },
)

export const completeChangeAssurance = Action(
    {
        $id: Now.ID['complete_change_assurance_action'],
        name: 'Complete Forward Change Assurance',
        internalName: 'complete_forward_change_assurance',
        description: 'Submit fresh deployment and Dynatrace context to complete an assurance run',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        inputs: {
            run_id: StringColumn({ label: 'Run ID', mandatory: true, maxLength: 64 }),
            context_json: StringColumn({ label: 'Change context JSON', mandatory: true, maxLength: 65535 }),
        },
        outputs: {
            run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
            status: StringColumn({ label: 'Status', maxLength: 64 }),
            phase: StringColumn({ label: 'Phase', maxLength: 32 }),
            decision: StringColumn({ label: 'Decision', maxLength: 16 }),
            network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
            before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
            after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['complete_change_assurance_script'], label: 'Call assurance worker completion' },
            {
                required_run_time: 'instance',
                script: Now.include('../server/actions/complete-change-assurance.server.js'),
                inputVariables: {
                    run_id: { label: 'Run ID', value: wfa.dataPill(params.inputs.run_id, 'string') },
                    context_json: { label: 'Change context JSON', value: wfa.dataPill(params.inputs.context_json, 'string') },
                },
                outputVariables: {
                    run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
                    status: StringColumn({ label: 'Status', maxLength: 64 }),
                    phase: StringColumn({ label: 'Phase', maxLength: 32 }),
                    decision: StringColumn({ label: 'Decision', maxLength: 16 }),
                    network_id: StringColumn({ label: 'Forward Network ID', maxLength: 255 }),
                    before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
                    after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
                },
                errorHandlingType: 'stop_the_action',
            },
        )
        wfa.assignActionOutputs(params.outputs, {
            run_id: wfa.dataPill(step.run_id, 'string'),
            status: wfa.dataPill(step.status, 'string'),
            phase: wfa.dataPill(step.phase, 'string'),
            decision: wfa.dataPill(step.decision, 'string'),
            network_id: wfa.dataPill(step.network_id, 'string'),
            before_snapshot_id: wfa.dataPill(step.before_snapshot_id, 'string'),
            after_snapshot_id: wfa.dataPill(step.after_snapshot_id, 'string'),
        })
    },
)

export const checkForwardPath = Action(
    {
        $id: Now.ID['check_forward_path_action'],
        name: 'Check Forward Path',
        internalName: 'check_forward_path',
        description: 'Run a Forward path search for a Forward Path Validation record and record the verdict on it. Run the calling flow as the user, not as System: the record ACLs apply to the caller.',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        inputs: {
            validation_sys_id: StringColumn({ label: 'Path validation sys_id', mandatory: true, maxLength: 32 }),
            pinned_snapshot_id: StringColumn({ label: 'Pin to Forward Snapshot ID (optional)', maxLength: 64 }),
        },
        outputs: {
            validation_status: StringColumn({ label: 'Validation status', maxLength: 16 }),
            observed_outcome: StringColumn({ label: 'Observed outcome', maxLength: 16 }),
            snapshot_id: StringColumn({ label: 'Forward Snapshot ID', maxLength: 255 }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['check_forward_path_script'], label: 'Run Forward path search' },
            {
                required_run_time: 'instance',
                script: Now.include('../server/actions/check-forward-path.server.js'),
                inputVariables: {
                    validation_sys_id: { label: 'Path validation sys_id', value: wfa.dataPill(params.inputs.validation_sys_id, 'string') },
                    pinned_snapshot_id: { label: 'Pinned snapshot ID', value: wfa.dataPill(params.inputs.pinned_snapshot_id, 'string') },
                },
                outputVariables: {
                    validation_status: StringColumn({ label: 'Validation status', maxLength: 16 }),
                    observed_outcome: StringColumn({ label: 'Observed outcome', maxLength: 16 }),
                    snapshot_id: StringColumn({ label: 'Forward Snapshot ID', maxLength: 255 }),
                },
                errorHandlingType: 'stop_the_action',
            },
        )
        wfa.assignActionOutputs(params.outputs, {
            validation_status: wfa.dataPill(step.validation_status, 'string'),
            observed_outcome: wfa.dataPill(step.observed_outcome, 'string'),
            snapshot_id: wfa.dataPill(step.snapshot_id, 'string'),
        })
    },
)

export const listForwardMaps = Action(
    {
        $id: Now.ID['list_forward_maps_action'],
        name: 'List Forward Maps',
        internalName: 'list_forward_maps',
        description: 'List the Forward Network Maps that match a Change Request. Read only; a Forward refusal is returned as a note. Map names come from Forward: escape maps_json before showing it. Run the calling flow as the user, not as System.',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        inputs: { change_sys_id: StringColumn({ label: 'Change Request sys_id', mandatory: true, maxLength: 32 }) },
        outputs: {
            maps_json: StringColumn({ label: 'Matching maps JSON', maxLength: 65535 }),
            match_count: IntegerColumn({ label: 'Match count' }),
            note: StringColumn({ label: 'Note', maxLength: 1000 }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['list_forward_maps_script'], label: 'Read matching Forward maps' },
            {
                required_run_time: 'instance',
                script: Now.include('../server/actions/list-forward-maps.server.js'),
                inputVariables: {
                    change_sys_id: { label: 'Change Request sys_id', value: wfa.dataPill(params.inputs.change_sys_id, 'string') },
                },
                outputVariables: {
                    maps_json: StringColumn({ label: 'Matching maps JSON', maxLength: 65535 }),
                    match_count: IntegerColumn({ label: 'Match count' }),
                    note: StringColumn({ label: 'Note', maxLength: 1000 }),
                },
                errorHandlingType: 'stop_the_action',
            },
        )
        wfa.assignActionOutputs(params.outputs, {
            maps_json: wfa.dataPill(step.maps_json, 'string'),
            match_count: wfa.dataPill(step.match_count, 'integer'),
            note: wfa.dataPill(step.note, 'string'),
        })
    },
)

export const startForwardPrediction = Action(
    {
        $id: Now.ID['start_forward_prediction_action'],
        name: 'Start Forward Prediction',
        internalName: 'start_forward_prediction',
        description: 'Ask Forward Predict about the commands proposed for a Change Request. Writes a change set to Forward, so it needs forward.predict_enabled and confirm set to true. Advisory only. Run the calling flow as the user, not as System.',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        inputs: {
        change_sys_id: StringColumn({ label: 'Change Request sys_id', mandatory: true, maxLength: 32 }),
        confirm: StringColumn({ label: 'Confirm (must be true)', mandatory: true, maxLength: 5 }),
        },
        outputs: {
            outcome: StringColumn({ label: 'Outcome', maxLength: 16 }),
            predicted_snapshot_id: StringColumn({ label: 'Predicted Snapshot ID', maxLength: 64 }),
            run_id: StringColumn({ label: 'Run sys_id', maxLength: 32 }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['start_forward_prediction_script'], label: 'Start Forward Prediction' },
            {
                required_run_time: 'instance',
                script: Now.include('../server/actions/start-forward-prediction.server.js'),
                inputVariables: {
                    change_sys_id: { label: 'Change Request sys_id', value: wfa.dataPill(params.inputs.change_sys_id, 'string') },
                    confirm: { label: 'Confirm (must be true)', value: wfa.dataPill(params.inputs.confirm, 'string') },
                },
                outputVariables: {
                    outcome: StringColumn({ label: 'Outcome', maxLength: 16 }),
                    predicted_snapshot_id: StringColumn({ label: 'Predicted Snapshot ID', maxLength: 64 }),
                    run_id: StringColumn({ label: 'Run sys_id', maxLength: 32 }),
                },
                errorHandlingType: 'stop_the_action',
            },
        )
        wfa.assignActionOutputs(params.outputs, {
            outcome: wfa.dataPill(step.outcome, 'string'),
            predicted_snapshot_id: wfa.dataPill(step.predicted_snapshot_id, 'string'),
            run_id: wfa.dataPill(step.run_id, 'string'),
        })
    },
)

export const refreshForwardPrediction = Action(
    {
        $id: Now.ID['refresh_forward_prediction_action'],
        name: 'Refresh Forward Prediction',
        internalName: 'refresh_forward_prediction',
        description: 'Check whether the Forward prediction for a Change Request has finished. Reads Forward and updates the run. Run the calling flow as the user, not as System.',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        inputs: {
        change_sys_id: StringColumn({ label: 'Change Request sys_id', mandatory: true, maxLength: 32 }),
        },
        outputs: {
            outcome: StringColumn({ label: 'Outcome', maxLength: 16 }),
            predicted_snapshot_id: StringColumn({ label: 'Predicted Snapshot ID', maxLength: 64 }),
            stale: StringColumn({ label: 'Proposal changed since prediction', maxLength: 5 }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['refresh_forward_prediction_script'], label: 'Refresh Forward Prediction' },
            {
                required_run_time: 'instance',
                script: Now.include('../server/actions/refresh-forward-prediction.server.js'),
                inputVariables: {
                    change_sys_id: { label: 'Change Request sys_id', value: wfa.dataPill(params.inputs.change_sys_id, 'string') },
                },
                outputVariables: {
                    outcome: StringColumn({ label: 'Outcome', maxLength: 16 }),
                    predicted_snapshot_id: StringColumn({ label: 'Predicted Snapshot ID', maxLength: 64 }),
                    stale: StringColumn({ label: 'Proposal changed since prediction', maxLength: 5 }),
                },
                errorHandlingType: 'stop_the_action',
            },
        )
        wfa.assignActionOutputs(params.outputs, {
            outcome: wfa.dataPill(step.outcome, 'string'),
            predicted_snapshot_id: wfa.dataPill(step.predicted_snapshot_id, 'string'),
            stale: wfa.dataPill(step.stale, 'string'),
        })
    },
)
