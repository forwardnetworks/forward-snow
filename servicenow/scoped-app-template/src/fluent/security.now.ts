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
Acl({
    $id: Now.ID['predict_run_create_deny_acl'],
    type: 'record', table: '__SCOPE___predict_run', operation: 'create', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Never allows a user write: runs are written by script only, because an editable change-set id would let cleanup delete an arbitrary change set',
})
Acl({
    $id: Now.ID['predict_run_write_deny_acl'],
    type: 'record', table: '__SCOPE___predict_run', operation: 'write', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Never allows a user write: runs are written by script only, because an editable change-set id would let cleanup delete an arbitrary change set',
})
Acl({
    $id: Now.ID['predict_run_delete_deny_acl'],
    type: 'record', table: '__SCOPE___predict_run', operation: 'delete', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Never allows a user write: runs are written by script only, because an editable change-set id would let cleanup delete an arbitrary change set',
})

Acl({
    $id: Now.ID['criterion_read_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'read', decisionType: 'allow',
    roles: [adminRole, auditorRole, operatorRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['criterion_create_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'create', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
    script: "var change = new GlideRecord('change_request'); answer = !!current.getValue('change') && change.get(current.getValue('change')) && change.canWrite();",
})
Acl({
    $id: Now.ID['criterion_write_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'write', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
    script: "var change = new GlideRecord('change_request'); answer = !!current.getValue('change') && change.get(current.getValue('change')) && change.canWrite();",
})
Acl({
    $id: Now.ID['criterion_delete_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'delete', decisionType: 'allow',
    roles: [adminRole, operatorRole], adminOverrides: true,
    script: "var change = new GlideRecord('change_request'); answer = !!current.getValue('change') && change.get(current.getValue('change')) && change.canWrite();",
})
Acl({
    $id: Now.ID['criterion_query_id_write_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'write', decisionType: 'allow',
    field: 'query_id',
    script: 'answer = false;', adminOverrides: false,
    description: 'Pinned by Bind only, so a verdict always refers to the version that was pinned',
})
Acl({
    $id: Now.ID['criterion_commit_id_write_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'write', decisionType: 'allow',
    field: 'commit_id',
    script: 'answer = false;', adminOverrides: false,
    description: 'Pinned by Bind only, so a verdict always refers to the version that was pinned',
})
Acl({
    $id: Now.ID['validation_run_read_acl'],
    type: 'record', table: '__SCOPE___validation_run', operation: 'read', decisionType: 'allow',
    roles: [adminRole, auditorRole, operatorRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['validation_run_create_deny_acl'],
    type: 'record', table: '__SCOPE___validation_run', operation: 'create', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by script only',
})
Acl({
    $id: Now.ID['validation_run_write_deny_acl'],
    type: 'record', table: '__SCOPE___validation_run', operation: 'write', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by script only',
})
Acl({
    $id: Now.ID['validation_run_delete_deny_acl'],
    type: 'record', table: '__SCOPE___validation_run', operation: 'delete', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by script only',
})
Acl({
    $id: Now.ID['validation_result_read_acl'],
    type: 'record', table: '__SCOPE___validation_result', operation: 'read', decisionType: 'allow',
    roles: [adminRole, auditorRole, operatorRole], adminOverrides: true,
})
Acl({
    $id: Now.ID['validation_result_create_deny_acl'],
    type: 'record', table: '__SCOPE___validation_result', operation: 'create', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by script only',
})
Acl({
    $id: Now.ID['validation_result_write_deny_acl'],
    type: 'record', table: '__SCOPE___validation_result', operation: 'write', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by script only',
})
Acl({
    $id: Now.ID['validation_result_delete_deny_acl'],
    type: 'record', table: '__SCOPE___validation_result', operation: 'delete', decisionType: 'allow',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by script only',
})
Acl({
    $id: Now.ID['criterion_query_id_create_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'create', decisionType: 'allow', field: 'query_id',
    script: 'answer = false;', adminOverrides: false,
    description: 'Set by Bind only',
})
Acl({
    $id: Now.ID['criterion_commit_id_create_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'create', decisionType: 'allow', field: 'commit_id',
    script: 'answer = false;', adminOverrides: false,
    description: 'Set by Bind only',
})
Acl({
    $id: Now.ID['criterion_binding_note_create_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'create', decisionType: 'allow', field: 'binding_note',
    script: 'answer = false;', adminOverrides: false,
    description: 'Set by Bind only',
})
Acl({
    $id: Now.ID['criterion_binding_note_write_acl'],
    type: 'record', table: '__SCOPE___criterion', operation: 'write', decisionType: 'allow', field: 'binding_note',
    script: 'answer = false;', adminOverrides: false,
    description: 'Set by Bind only',
})
Acl({
    $id: Now.ID['change_validation_status_create_acl'],
    type: 'record', table: 'change_request', operation: 'create', decisionType: 'allow', field: '__SCOPE___validation_status',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_validation_status_write_acl'],
    type: 'record', table: 'change_request', operation: 'write', decisionType: 'allow', field: '__SCOPE___validation_status',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_validation_score_create_acl'],
    type: 'record', table: 'change_request', operation: 'create', decisionType: 'allow', field: '__SCOPE___validation_score',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_validation_score_write_acl'],
    type: 'record', table: 'change_request', operation: 'write', decisionType: 'allow', field: '__SCOPE___validation_score',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_validation_snapshot_id_create_acl'],
    type: 'record', table: 'change_request', operation: 'create', decisionType: 'allow', field: '__SCOPE___validation_snapshot_id',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_validation_snapshot_id_write_acl'],
    type: 'record', table: 'change_request', operation: 'write', decisionType: 'allow', field: '__SCOPE___validation_snapshot_id',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_criteria_revision_create_acl'],
    type: 'record', table: 'change_request', operation: 'create', decisionType: 'allow', field: '__SCOPE___criteria_revision',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_criteria_revision_write_acl'],
    type: 'record', table: 'change_request', operation: 'write', decisionType: 'allow', field: '__SCOPE___criteria_revision',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_predict_revision_create_acl'],
    type: 'record', table: 'change_request', operation: 'create', decisionType: 'allow', field: '__SCOPE___predict_revision',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
Acl({
    $id: Now.ID['change_predict_revision_write_acl'],
    type: 'record', table: 'change_request', operation: 'write', decisionType: 'allow', field: '__SCOPE___predict_revision',
    script: 'answer = false;', adminOverrides: false,
    description: 'Written by the application only, so an approval policy can rely on it',
})
