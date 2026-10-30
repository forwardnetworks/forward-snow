import { Acl, RestApi, ScriptInclude } from '@servicenow/sdk/core'
import { evidenceWriterRole } from './roles.now'

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
