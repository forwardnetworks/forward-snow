import { Subflow, action, wfa } from '@servicenow/sdk/automation'
import { BooleanColumn, ReferenceColumn, StringColumn } from '@servicenow/sdk/core'
import { completeChangeAssurance, getChangeAssuranceStatus, startChangeAssurance } from './actions.now'
import { operatorRole } from './roles.now'

export const startChangeAssuranceSubflow = Subflow(
    {
        $id: Now.ID['start_change_assurance_subflow'],
        name: 'Start Forward Change Assurance',
        internalName: 'start_forward_change_assurance',
        description: 'Start a baseline run and correlate it to the Change Request',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        runAs: 'user',
        runWithRoles: [operatorRole],
        inputs: {
            change_request: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', mandatory: true }),
            change_number: StringColumn({ label: 'Change number', mandatory: true, maxLength: 32 }),
            deployment_id: StringColumn({ label: 'Deployment ID', mandatory: true, maxLength: 255 }),
            affected_records_json: StringColumn({ label: 'Affected records JSON', mandatory: true, maxLength: 65535 }),
            instance_alias: StringColumn({ label: 'ServiceNow instance alias', maxLength: 128 }),
            dependencies_json: StringColumn({ label: 'Optional Dynatrace dependencies JSON', maxLength: 65535 }),
            retry: BooleanColumn({ label: 'Retry unchanged failed start', default: false }),
        },
        outputs: {
            run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
            status: StringColumn({ label: 'Status', maxLength: 64 }),
            decision: StringColumn({ label: 'Decision', maxLength: 16 }),
            before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
            after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
        },
    },
    (params) => {
        const result = wfa.action(
            startChangeAssurance,
            { $id: Now.ID['invoke_start_change_assurance'] },
            {
                change_number: wfa.dataPill(params.inputs.change_number, 'string'),
                deployment_id: wfa.dataPill(params.inputs.deployment_id, 'string'),
                affected_records_json: wfa.dataPill(params.inputs.affected_records_json, 'string'),
                instance_alias: wfa.dataPill(params.inputs.instance_alias, 'string'),
                dependencies_json: wfa.dataPill(params.inputs.dependencies_json, 'string'),
                retry: wfa.dataPill(params.inputs.retry, 'boolean'),
            },
        )
        wfa.action(action.core.updateRecord, { $id: Now.ID['correlate_start_to_change'] }, {
            table_name: 'change_request',
            record: wfa.dataPill(params.inputs.change_request, 'reference'),
            values: TemplateValue({
                __SCOPE___assurance_run_id: wfa.dataPill(result.run_id, 'string'),
                __SCOPE___assurance_status: wfa.dataPill(result.status, 'string'),
                __SCOPE___assurance_decision: 'pending',
            }),
        })
        wfa.flowLogic.assignSubflowOutputs(
            { $id: Now.ID['assign_start_subflow_outputs'] },
            params.outputs,
            {
                run_id: wfa.dataPill(result.run_id, 'string'),
                status: wfa.dataPill(result.status, 'string'),
                decision: wfa.dataPill(result.decision, 'string'),
                before_snapshot_id: wfa.dataPill(result.before_snapshot_id, 'string'),
                after_snapshot_id: wfa.dataPill(result.after_snapshot_id, 'string'),
            },
        )
    },
)

export const refreshChangeAssuranceSubflow = Subflow(
    {
        $id: Now.ID['refresh_change_assurance_subflow'],
        name: 'Refresh Forward Change Assurance',
        internalName: 'refresh_forward_change_assurance',
        description: 'Refresh bounded worker state and copy it to the Change Request',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        runAs: 'user',
        runWithRoles: [operatorRole],
        inputs: {
            change_request: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', mandatory: true }),
            run_id: StringColumn({ label: 'Run ID', mandatory: true, maxLength: 64 }),
        },
        outputs: {
            run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
            status: StringColumn({ label: 'Status', maxLength: 64 }),
            decision: StringColumn({ label: 'Decision', maxLength: 16 }),
            before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
            after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
        },
    },
    (params) => {
        const result = wfa.action(
            getChangeAssuranceStatus,
            { $id: Now.ID['invoke_refresh_change_assurance'] },
            { run_id: wfa.dataPill(params.inputs.run_id, 'string') },
        )
        wfa.action(action.core.updateRecord, { $id: Now.ID['correlate_refresh_to_change'] }, {
            table_name: 'change_request',
            record: wfa.dataPill(params.inputs.change_request, 'reference'),
            values: TemplateValue({
                __SCOPE___assurance_status: wfa.dataPill(result.status, 'string'),
                __SCOPE___assurance_decision: wfa.dataPill(result.decision, 'string'),
            }),
        })
        wfa.flowLogic.assignSubflowOutputs(
            { $id: Now.ID['assign_refresh_subflow_outputs'] }, params.outputs,
            {
                run_id: wfa.dataPill(result.run_id, 'string'),
                status: wfa.dataPill(result.status, 'string'),
                decision: wfa.dataPill(result.decision, 'string'),
                before_snapshot_id: wfa.dataPill(result.before_snapshot_id, 'string'),
                after_snapshot_id: wfa.dataPill(result.after_snapshot_id, 'string'),
            },
        )
    },
)

export const completeChangeAssuranceSubflow = Subflow(
    {
        $id: Now.ID['complete_change_assurance_subflow'],
        name: 'Complete Forward Change Assurance',
        internalName: 'complete_forward_change_assurance',
        description: 'Submit fresh trusted completion context and correlate worker state to the Change Request',
        category: 'Forward Change Assurance',
        access: 'public',
        protectionPolicy: 'read',
        runAs: 'user',
        runWithRoles: [operatorRole],
        inputs: {
            change_request: ReferenceColumn({ label: 'Change Request', referenceTable: 'change_request', mandatory: true }),
            run_id: StringColumn({ label: 'Run ID', mandatory: true, maxLength: 64 }),
            context_json: StringColumn({ label: 'Change context JSON', mandatory: true, maxLength: 65535 }),
        },
        outputs: {
            run_id: StringColumn({ label: 'Run ID', maxLength: 64 }),
            status: StringColumn({ label: 'Status', maxLength: 64 }),
            decision: StringColumn({ label: 'Decision', maxLength: 16 }),
            before_snapshot_id: StringColumn({ label: 'Before Snapshot ID', maxLength: 255 }),
            after_snapshot_id: StringColumn({ label: 'After Snapshot ID', maxLength: 255 }),
        },
    },
    (params) => {
        const result = wfa.action(
            completeChangeAssurance,
            { $id: Now.ID['invoke_complete_change_assurance'] },
            {
                run_id: wfa.dataPill(params.inputs.run_id, 'string'),
                context_json: wfa.dataPill(params.inputs.context_json, 'string'),
            },
        )
        wfa.action(action.core.updateRecord, { $id: Now.ID['correlate_completion_to_change'] }, {
            table_name: 'change_request',
            record: wfa.dataPill(params.inputs.change_request, 'reference'),
            values: TemplateValue({
                __SCOPE___assurance_status: wfa.dataPill(result.status, 'string'),
                __SCOPE___assurance_decision: wfa.dataPill(result.decision, 'string'),
            }),
        })
        wfa.flowLogic.assignSubflowOutputs(
            { $id: Now.ID['assign_complete_subflow_outputs'] }, params.outputs,
            {
                run_id: wfa.dataPill(result.run_id, 'string'),
                status: wfa.dataPill(result.status, 'string'),
                decision: wfa.dataPill(result.decision, 'string'),
                before_snapshot_id: wfa.dataPill(result.before_snapshot_id, 'string'),
                after_snapshot_id: wfa.dataPill(result.after_snapshot_id, 'string'),
            },
        )
    },
)
