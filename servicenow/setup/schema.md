# ServiceNow Schema

Create these objects before loading the widget and script assets.

The package supports global custom tables (`u_*`). Some server code can read scoped-app table overrides through system properties for migration compatibility.

## Tables

`u_forward_connectivity_ticket`

- Label: `Forward Workflow Ticket`
- Extends: `task`

`u_forward_connectivity_hop`

- Label: `Forward Workflow Hop`
- Standalone table

`u_forward_tenant_binding`

- Label: `Forward Tenant Binding`
- Standalone table

`u_forward_change_validation`

- Label: `Forward Change Validation`
- Extends: `task`

`u_forward_change_assurance`

- Label: `Forward Change Assurance`
- Extends: `task`
- Direct web-service access: disabled; writes use the role-gated, checksummed Scripted REST resource

## Forward Workflow Ticket Fields

| Field | Type | Notes |
| --- | --- | --- |
| `u_source_ci` | Reference | `cmdb_ci_netgear` |
| `u_destination_ci` | Reference | `cmdb_ci_netgear` |
| `u_src_ip` | String | max 45 |
| `u_dst_ip` | String | max 45 |
| `u_protocol` | Choice | `TCP`, `UDP`; default `TCP` |
| `u_dst_port` | Integer |  |
| `u_forward_network_id` | String |  |
| `u_forward_snapshot_id` | String |  |
| `u_forward_tenant_username` | String | ServiceNow username bound to Forward credentials |
| `u_allowed` | True/False |  |
| `u_block_category` | Choice | `network`, `security`, `blackhole`, `reachability`, `analysis_error`, `unknown` |
| `u_block_device` | String |  |
| `u_block_interface` | String |  |
| `u_block_rule` | String |  |
| `u_block_reason` | String |  |
| `u_forward_query_url` | URL |  |
| `u_recommended_team` | Choice | `network`, `security`, `triage`; default `triage` |
| `u_forward_evidence_summary` | HTML | max 4000 |
| `u_incident` | Reference | `incident` |
| `u_incident_number` | String |  |
| `u_raw_excerpt` | HTML |  |
| `u_analysis_status` | Choice | `not_run`, `running`, `complete`, `error`; default `not_run` |
| `u_analysis_error` | String | max 4000 |

## Forward Workflow Hop Fields

| Field | Type | Notes |
| --- | --- | --- |
| `u_ticket` | Reference | `u_forward_connectivity_ticket` |
| `u_hop_index` | Integer |  |
| `u_device` | String |  |
| `u_ingress` | String |  |
| `u_egress` | String |  |
| `u_note` | String |  |

## Forward Tenant Binding Fields

| Field | Type | Notes |
| --- | --- | --- |
| `u_tenant_username` | String | ServiceNow username bound to Forward API access |
| `u_forward_base_url` | URL | usually `https://fwd.app/api` |
| `u_forward_auth_profile` | Reference | `sys_auth_profile_basic`; preferred production credential storage |
| `u_forward_username` | String | Forward access key or username; lab fallback only |
| `u_forward_password` | Password (2 Way Encrypted) | Forward secret or password; lab fallback only |

## Forward Change Validation Fields

| Field | Type | Notes |
| --- | --- | --- |
| `u_change_request` | Reference | `change_request` |
| `u_src_ip` | String | max 45 |
| `u_dst_ip` | String | max 45 |
| `u_protocol` | Choice | `TCP`, `UDP`; default `TCP` |
| `u_dst_port` | Integer |  |
| `u_forward_network_id` | String |  |
| `u_forward_snapshot_id` | String |  |
| `u_forward_tenant_username` | String | ServiceNow username bound to Forward credentials |
| `u_expected_outcome` | Choice | `allowed`, `blocked` |
| `u_validation_status` | Choice | `not_run`, `pass`, `fail`, `error` |
| `u_allowed` | True/False | Observed Forward verdict |
| `u_block_category` | Choice | `network`, `security`, `blackhole`, `reachability`, `analysis_error`, `unknown` |
| `u_block_device` | String |  |
| `u_block_interface` | String |  |
| `u_block_rule` | String |  |
| `u_block_reason` | String |  |
| `u_forward_query_url` | URL |  |
| `u_forward_evidence_summary` | HTML | max 4000 |
| `u_raw_excerpt` | HTML | max 8000 |

## Forward Change Assurance Fields

| Field | Type | Notes |
| --- | --- | --- |
| `u_change_request` | Reference | `change_request` |
| `u_run_id` | String | Stable assurance run ID |
| `u_idempotency_key` | String | Unique `forward-dynatrace:<evidence SHA-256>` |
| `u_deployment_id` | String | Customer deployment correlation ID |
| `u_service_entity_ids` | String | Comma-separated affected Dynatrace entity IDs |
| `u_lifecycle_state` | Choice | `received`, `baseline_pending`, `baseline_captured`, `waiting`, `evidence_received`, `complete`, `error` |
| `u_decision` | Choice | `pass`, `warn`, `fail` |
| `u_reason_codes` | String | Comma-separated deterministic reason codes |
| `u_forward_network_id` | String | Forward network ID |
| `u_before_snapshot_id` | String | Approved before snapshot |
| `u_after_snapshot_id` | String | New processed after snapshot |
| `u_reconciliation_run_id` | String | Forward dry-run reconciliation ID |
| `u_reconciliation_state` | String | Aggregate reconciliation state |
| `u_dynatrace_deployment_state` | String | `SUCCEEDED`, `FAILED`, `IN_PROGRESS`, `UNKNOWN` |
| `u_dynatrace_service_health` | String | `HEALTHY`, `DEGRADED`, `UNHEALTHY`, `UNKNOWN` |
| `u_dynatrace_open_problem_count` | Integer | Affected-service problem count |
| `u_preflight_sha256` | String | Authoritative ServiceNow preflight hash |
| `u_gate_sha256` | String | Aggregate gate hash |
| `u_evidence_sha256` | String | Attached evidence bytes hash |
| `u_generated_at` | Date/Time | Evidence generation time |
| `u_attachment` | Reference | `sys_attachment` bounded JSON evidence |
| `u_work_note_marker` | String | Stable journal idempotency marker |
| `u_publication_status` | Choice | `pending`, `attachment_ready`, `published`, `error` |
| `u_publication_error` | String | Bounded publication failure text |

## Change Request Flow Correlation Fields

| Field | Type | Notes |
| --- | --- | --- |
| `change_request.u_forward_assurance_run_id` | String | Deterministic worker run ID returned by the Start action |
| `change_request.u_forward_assurance_status` | Choice | Bounded worker lifecycle copied by Flow Designer |
| `change_request.u_forward_assurance_decision` | Choice | `pending`, `pass`, `warn`, or `fail` |

## System Properties

| Property | Default |
| --- | --- |
| `x_fwd_demo.forward.max_results` | `1` |
| `x_fwd_demo.forward.allowed_base_urls` | `https://fwd.app/api` |
| `x_fwd_demo.forward.request_timeout_ms` | `30000` |
| `x_fwd_demo.forward.default_network_id` | `235937` |
| `x_fwd_demo.cmdb.ci_table` | `cmdb_ci_netgear` |
| `x_fwd_demo.cmdb.max_cis` | `100` |
| `x_fwd_demo.tables.ticket` | `u_forward_connectivity_ticket` |
| `x_fwd_demo.tables.hop` | `u_forward_connectivity_hop` |
| `x_fwd_demo.tables.binding` | `u_forward_tenant_binding` |
| `x_fwd_demo.tables.change_validation` | `u_forward_change_validation` |
| `x_fwd_demo.tables.change_assurance` | `u_forward_change_assurance` |
| `x_fwd_demo.assurance.max_payload_bytes` | `262144` |
| `x_fwd_demo.assurance.writer_role` | `x_fwd_demo.assurance_writer` |
| `x_fwd_demo.assurance.ingress_base_uri` | Authoritative `sys_ws_definition.base_uri` discovered during install |
| `x_fwd_demo.assurance.worker_base_url` | Empty until the HTTPS worker is configured |
| `x_fwd_demo.assurance.worker_allowed_base_urls` | Exact configured worker origin |
| `x_fwd_demo.assurance.worker_auth_profile` | Basic Auth Profile sys_id; never a secret value |
| `x_fwd_demo.assurance.worker_timeout_ms` | `30000` |
| `x_fwd_demo.assurance.worker_max_payload_bytes` | `524288` |
| `x_fwd_demo.groups.network` | `Network Team` |
| `x_fwd_demo.groups.security` | `Security Team` |
| `x_fwd_demo.groups.triage` | `Triage` |
