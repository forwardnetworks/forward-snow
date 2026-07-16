import { BusinessRule } from '@servicenow/sdk/core'

BusinessRule({
    $id: Now.ID['change_assurance_close_guard_rule'],
    name: 'Forward Change Assurance close guard',
    table: 'change_request',
    active: true,
    when: 'before',
    action: ['update'],
    order: 100,
    script: Now.include('../server/ChangeAssuranceCloseGuardRule.server.js'),
    description: 'Blocks closure of assurance-bound changes until published Forward and Dynatrace evidence passes',
    protectionPolicy: 'read',
})
