import { Alias, Property } from '@servicenow/sdk/core'
import { adminRole } from './roles.now'

export const assuranceWorkerAlias = Alias({
    $id: Now.ID['assurance_worker_alias'],
    name: 'Forward Change Assurance Worker',
    connectionType: 'httpConnection',
    multipleConnections: false,
    description: 'Customer-bound exact HTTPS origin and credential for the Forward assurance worker',
})

export const forwardApiAlias = Alias({
    $id: Now.ID['forward_api_alias'],
    name: 'Forward API',
    connectionType: 'httpConnection',
    multipleConnections: false,
    description: 'Optional customer-bound Forward API connection for native lookups',
})

Property({
    $id: Now.ID['max_payload_bytes'], name: '__SCOPE__.assurance.max_payload_bytes', type: 'integer', value: 262144,
    description: 'Maximum accepted assurance evidence payload in bytes', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['worker_timeout_ms'], name: '__SCOPE__.assurance.worker_timeout_ms', type: 'integer', value: 30000,
    description: 'Outbound assurance worker timeout in milliseconds', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['worker_max_payload_bytes'], name: '__SCOPE__.assurance.worker_max_payload_bytes', type: 'integer', value: 524288,
    description: 'Maximum assurance worker request or response payload in bytes', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['enforced_close_states'], name: '__SCOPE__.assurance.enforced_close_states', type: 'string', value: '3',
    description: 'Comma-separated Change Request state values protected by the Forward Change Assurance close guard', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_timeout_ms'], name: '__SCOPE__.forward.timeout_ms', type: 'integer', value: 30000,
    description: 'Outbound Forward API timeout in milliseconds', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_max_response_bytes'], name: '__SCOPE__.forward.max_response_bytes', type: 'integer', value: 1048576,
    description: 'Maximum accepted Forward API response in bytes', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_max_path_results'], name: '__SCOPE__.forward.max_path_results', type: 'integer', value: 10,
    description: 'Maximum Forward paths returned and summarized per path search', roles: { read: [adminRole], write: [adminRole] },
})
