import { Acl } from '@servicenow/sdk/core'
import { adminRole, auditorRole, evidenceWriterRole, operatorRole } from './roles.now'

Acl({
    $id: Now.ID['assurance_read_acl'],
    type: 'record', table: '__SCOPE___assurance', operation: 'read', decisionType: 'allow',
    roles: [adminRole, auditorRole, evidenceWriterRole, operatorRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['assurance_create_acl'],
    type: 'record', table: '__SCOPE___assurance', operation: 'create', decisionType: 'allow',
    roles: [adminRole, evidenceWriterRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['assurance_write_acl'],
    type: 'record', table: '__SCOPE___assurance', operation: 'write', decisionType: 'allow',
    roles: [adminRole, evidenceWriterRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['assurance_delete_acl'],
    type: 'record', table: '__SCOPE___assurance', operation: 'delete', decisionType: 'allow',
    roles: [adminRole], adminOverrides: false, active: false,
    description: 'Deletion is disabled by default to retain assurance evidence',
})
Acl({
    $id: Now.ID['validation_read_acl'],
    type: 'record', table: '__SCOPE___validation', operation: 'read', decisionType: 'allow',
    roles: [adminRole, auditorRole, operatorRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['validation_create_acl'],
    type: 'record', table: '__SCOPE___validation', operation: 'create', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['validation_write_acl'],
    type: 'record', table: '__SCOPE___validation', operation: 'write', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['predict_proposal_read_acl'],
    type: 'record', table: '__SCOPE___predict_proposal', operation: 'read', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
    description: 'Proposed commands can hold secrets: the auditor role has no access, and a user needs write access to the change',
    script: "var change = new GlideRecord('change_request'); answer = !!current.getValue('change') && change.get(current.getValue('change')) && change.canWrite();",
})
Acl({
    $id: Now.ID['predict_proposal_create_acl'],
    type: 'record', table: '__SCOPE___predict_proposal', operation: 'create', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
    script: "var change = new GlideRecord('change_request'); answer = !!current.getValue('change') && change.get(current.getValue('change')) && change.canWrite();",
})
Acl({
    $id: Now.ID['predict_proposal_write_acl'],
    type: 'record', table: '__SCOPE___predict_proposal', operation: 'write', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
    script: "var change = new GlideRecord('change_request'); answer = !!current.getValue('change') && change.get(current.getValue('change')) && change.canWrite();",
})
Acl({
    $id: Now.ID['predict_proposal_delete_acl'],
    type: 'record', table: '__SCOPE___predict_proposal', operation: 'delete', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
    script: "var change = new GlideRecord('change_request'); answer = !!current.getValue('change') && change.get(current.getValue('change')) && change.canWrite();",
})
// Runs are written by script only. No create, write or delete rule exists on purpose: an editable change-set id
// would let a user make cleanup delete an arbitrary change set.
Acl({
    $id: Now.ID['predict_run_read_acl'],
    type: 'record', table: '__SCOPE___predict_run', operation: 'read', decisionType: 'allow',
    roles: [adminRole, auditorRole, operatorRole], adminOverrides: true,
})
