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
Property({
    $id: Now.ID['forward_network_id'], name: '__SCOPE__.forward.network_id', type: 'string', value: '',
    description: 'Forward network ID that Network Maps are read from', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_maps_enabled'], name: '__SCOPE__.forward.maps_enabled', type: 'boolean', value: true,
    description: 'Show Forward Network Maps that match a Change Request; turn off to stop reading maps', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_predict_enabled'], name: '__SCOPE__.forward.predict_enabled', type: 'boolean', value: false,
    description: 'Allow Forward Predict to create change sets in the predict network. Off by default; every start also needs an explicit confirmation', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_predict_network_id'], name: '__SCOPE__.forward.predict_network_id', type: 'string', value: '',
    description: 'Forward network ID where Predict change sets are created. Use a dedicated network, not the production one; blank refuses Predict', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_predict_max_devices'], name: '__SCOPE__.forward.predict_max_devices', type: 'integer', value: 10,
    description: 'Maximum devices one Forward Predict proposal may cover', roles: { read: [adminRole], write: [adminRole] },
})
Property({
    $id: Now.ID['forward_validation_max_criteria'], name: '__SCOPE__.forward.validation_max_criteria', type: 'integer', value: 20,
    description: 'Maximum validation criteria one Forward validation run may evaluate', roles: { read: [adminRole], write: [adminRole] },
})
