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
