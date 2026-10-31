import { BusinessRule } from '@servicenow/sdk/core'

BusinessRule({
    $id: Now.ID['predict_proposal_revision_rule'],
    name: 'Forward Predict proposal revision',
    table: '__SCOPE___predict_proposal',
    active: true,
    when: 'after',
    action: ['insert', 'update', 'delete'],
    order: 100,
    script: Now.include('../server/ForwardPredictRevisionRule.server.js'),
    description: 'Counts proposal changes on the Change Request so an earlier prediction is shown as stale',
    protectionPolicy: 'read',
})

BusinessRule({
    $id: Now.ID['predict_close_cleanup_rule'],
    name: 'Forward Predict cleanup on close',
    table: 'change_request',
    active: true,
    when: 'async',
    action: ['update'],
    order: 200,
    condition: 'current.state.changes() && (current.state == 3 || current.state == 4)',
    script: Now.include('../server/ForwardPredictCloseRule.server.js'),
    description: 'Deletes the Forward change set and the proposed commands after a change closes or is cancelled. Best effort; never blocks the change',
    protectionPolicy: 'read',
})

BusinessRule({
    $id: Now.ID['predict_delete_cleanup_rule'],
    name: 'Forward Predict cleanup on delete',
    table: 'change_request',
    active: true,
    when: 'before',
    action: ['delete'],
    order: 200,
    script: Now.include('../server/ForwardPredictDeleteRule.server.js'),
    description: 'Deletes the Forward change set of a change that is being deleted. Best effort; never blocks the delete',
    protectionPolicy: 'read',
})
