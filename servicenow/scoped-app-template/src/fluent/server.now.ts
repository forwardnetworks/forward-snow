import { Acl, RestApi, ScriptInclude, UiAction } from '@servicenow/sdk/core'
import { adminRole, auditorRole, evidenceWriterRole, operatorRole } from './roles.now'

ScriptInclude({
    $id: Now.ID['change_assurance_contract'], name: 'ChangeAssuranceContract',
    apiName: '__SCOPE__.ChangeAssuranceContract', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ChangeAssuranceContract.server.js'),
})
ScriptInclude({
    $id: Now.ID['change_assurance_service'], name: 'ChangeAssuranceService',
    apiName: '__SCOPE__.ChangeAssuranceService', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ChangeAssuranceService.server.js'),
})
ScriptInclude({
    $id: Now.ID['change_assurance_flow_client'], name: 'ChangeAssuranceFlowClient',
    apiName: '__SCOPE__.ChangeAssuranceFlowClient', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ChangeAssuranceFlowClient.server.js'),
})
ScriptInclude({
    $id: Now.ID['forward_api_client'], name: 'ForwardApiClient',
    apiName: '__SCOPE__.ForwardApiClient', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ForwardApiClient.server.js'),
})
ScriptInclude({
    $id: Now.ID['forward_maps_lookup'], name: 'ForwardMapsLookup',
    apiName: '__SCOPE__.ForwardMapsLookup', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ForwardMapsLookup.server.js'),
})
ScriptInclude({
    $id: Now.ID['forward_predict'], name: 'ForwardPredict',
    apiName: '__SCOPE__.ForwardPredict', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ForwardPredict.server.js'),
})
ScriptInclude({
    $id: Now.ID['forward_validation'], name: 'ForwardValidation',
    apiName: '__SCOPE__.ForwardValidation', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ForwardValidation.server.js'),
})
ScriptInclude({
    $id: Now.ID['forward_path_check'], name: 'ForwardPathCheck',
    apiName: '__SCOPE__.ForwardPathCheck', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ForwardPathCheck.server.js'),
})
ScriptInclude({
    $id: Now.ID['change_assurance_close_guard'], name: 'ChangeAssuranceCloseGuard',
    apiName: '__SCOPE__.ChangeAssuranceCloseGuard', active: true, clientCallable: false,
    accessibleFrom: 'package_private', protectionPolicy: 'read',
    script: Now.include('../server/ChangeAssuranceCloseGuard.server.js'),
})

const evidenceRestAcl = Acl({
    $id: Now.ID['evidence_rest_acl'], name: 'forward_change_assurance_evidence',
    type: 'rest_endpoint', operation: 'execute', roles: [evidenceWriterRole],
    securityAttribute: 'user_is_authenticated', adminOverrides: true,
})

RestApi({
    $id: Now.ID['change_assurance_rest_api'], name: 'Forward Change Assurance',
    serviceId: 'forward_change_assurance', active: true, consumes: 'application/json', produces: 'application/json',
    enforceAcl: [evidenceRestAcl], protectionPolicy: 'read',
    routes: [{
        $id: Now.ID['change_assurance_evidence_post'], name: 'Submit change assurance evidence',
        path: '/changes/{change_sys_id}/evidence', method: 'POST', active: true,
        authentication: true, authorization: true, consumes: 'application/json', produces: 'application/json',
        enforceAcl: [evidenceRestAcl],
        headers: [{
            $id: Now.ID['evidence_sha256_header'], name: 'X-Forward-Dynatrace-SHA256', required: true,
            shortDescription: 'SHA-256 of the exact request body bytes',
        }],
        script: Now.include('../server/ChangeAssuranceIngest.server.js'),
        shortDescription: 'Validate and publish checksum-bound Forward and Dynatrace evidence',
        protectionPolicy: 'read',
    }],
})

UiAction({
    $id: Now.ID['show_forward_maps_ui_action'], table: 'change_request', name: 'Show Forward Maps',
    actionName: 'show_forward_maps', active: true, form: { showButton: true, style: 'unstyled' },
    showInsert: false, showUpdate: true, hint: 'List the Forward Network Maps that match this change',
    roles: [adminRole, auditorRole, operatorRole],
    condition: "gs.getProperty('__SCOPE__.forward.maps_enabled', 'true') == 'true'",
    script: Now.include('../server/ForwardMapsUiAction.server.js'),
})

UiAction({
    $id: Now.ID['forward_predict_proposals_ui_action'], table: 'change_request', name: 'Forward Predict Proposals',
    actionName: 'forward_predict_proposals', active: true, form: { showButton: true, style: 'unstyled' },
    showInsert: false, showUpdate: true, hint: 'Open the commands proposed for this change, per device',
    roles: [adminRole, operatorRole],
    condition: "gs.getProperty('__SCOPE__.forward.predict_enabled', 'false') == 'true'",
    script: Now.include('../server/ForwardPredictProposalsUiAction.server.js'),
})
UiAction({
    $id: Now.ID['forward_predict_start_ui_action'], table: 'change_request', name: 'Start Forward Prediction',
    actionName: 'forward_predict_start', active: true, form: { showButton: true, style: 'unstyled' },
    showInsert: false, showUpdate: true, hint: 'Ask Forward Predict about the proposed commands (writes a change set to Forward)',
    roles: [adminRole, operatorRole],
    client: { isClient: true, onClick: 'confirmForwardPredict()' },
    condition: "gs.getProperty('__SCOPE__.forward.predict_enabled', 'false') == 'true' && current.state != 3 && current.state != 4",
    script: Now.include('../server/ForwardPredictStartUiAction.server.js'),
})
UiAction({
    $id: Now.ID['forward_predict_refresh_ui_action'], table: 'change_request', name: 'Refresh Forward Prediction',
    actionName: 'forward_predict_refresh', active: true, form: { showButton: true, style: 'unstyled' },
    showInsert: false, showUpdate: true, hint: 'Check whether the Forward prediction has finished',
    roles: [adminRole, operatorRole],
    script: Now.include('../server/ForwardPredictRefreshUiAction.server.js'),
})
