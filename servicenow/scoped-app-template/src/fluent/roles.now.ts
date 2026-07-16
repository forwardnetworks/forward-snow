import { Role } from '@servicenow/sdk/core'

export const auditorRole = Role({
    name: '__SCOPE__.auditor',
    description: 'Read Forward Change Assurance ledger and retained evidence',
})

export const evidenceWriterRole = Role({
    name: '__SCOPE__.evidence_writer',
    description: 'Submit bounded checksum-validated assurance evidence',
})

export const operatorRole = Role({
    name: '__SCOPE__.operator',
    description: 'Run Forward Change Assurance actions from authorized Change Requests',
    containsRoles: [auditorRole],
})

export const adminRole = Role({
    name: '__SCOPE__.admin',
    description: 'Administer Forward Change Assurance policy, aliases, and migrations',
    scopedAdmin: true,
    containsRoles: [auditorRole, evidenceWriterRole, operatorRole],
})
