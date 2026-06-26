# Forward Install Guide

This guide explains exactly what `scripts/configure_forward_integrations.py` installs in Forward and how to verify it.

## Inputs

Required Forward inputs:

| Variable | Meaning |
| --- | --- |
| `FORWARD_BASE_URL` | Forward API base URL. Default: `https://fwd.app/api`. |
| `FORWARD_USERNAME` | Forward access key or API username. |
| `FORWARD_PASSWORD` | Forward secret or API password. |
| `FORWARD_TOKEN_FILE` | Optional replacement for `FORWARD_USERNAME` and `FORWARD_PASSWORD`. |
| `NETWORK_ID` | Forward network ID used for CMDB sync. |

Required ServiceNow inputs:

| Variable | Meaning |
| --- | --- |
| `SN_INSTANCE_URL` | ServiceNow instance URL. |
| `SN_USERNAME` | ServiceNow integration/admin username used by Forward ticketing and CMDB. |
| `SN_PASSWORD` | ServiceNow integration/admin password used by Forward ticketing and CMDB. |

Optional controls:

| Variable | Meaning |
| --- | --- |
| `USE_STOCK_NQE=1` | Use Forward stock `/External/ServiceNow/CMDB Netgear CI` query instead of packaged field query. |
| `FIELD_NQE_PATH` | Override the org NQE path installed by this package. |
| `FIELD_NQE_SOURCE_FILE` | Override the local NQE source file. |
| `DRY_RUN=1` | Print write calls without changing Forward. |

## Command

```bash
export FORWARD_BASE_URL='https://fwd.app/api'
export FORWARD_USERNAME='<Forward access key>'
export FORWARD_PASSWORD='<Forward secret>'
export NETWORK_ID='<Forward network id>'

export SN_INSTANCE_URL='https://<instance>.service-now.com'
export SN_USERNAME='<ServiceNow integration user>'
export SN_PASSWORD='<ServiceNow integration password>'

python3 scripts/configure_forward_integrations.py
```

## What Happens In Forward

### 1. Network Check

The script calls Forward snapshots for `NETWORK_ID`.

Success:

```text
Forward network <id> reachable; latest processed snapshot: <snapshot id>
```

If no processed snapshot is available, the script can still configure ticketing and CMDB, but it skips NQE analysis validation.

### 2. ServiceNow Ticketing

The script configures Forward ServiceNow ticketing:

- `enabled=true`
- `autoCreate=true`
- `autoUpdate=true`
- impact `3`
- urgency `3`
- ServiceNow instance URL
- ServiceNow username/password

Important behavior: Forward treats the ServiceNow `instanceUrl` as immutable after creation. If ticketing already points at another ServiceNow instance, the script deletes and recreates the Forward ticketing integration.

Success:

```text
Forward ticketing configured
```

### 3. NQE Query Install

By default, the script installs or updates:

```text
/ServiceNow/Forward Field Integration CMDB Netgear CI
```

The packaged source lives at:

```text
servicenow/nqe/Forward Field Integration CMDB Netgear CI
```

The script creates missing `/ServiceNow/` directories, adds or edits the query, commits the change to the org NQE repo, and validates the query against the latest processed snapshot.

Success, first install:

```text
Forward field integration NQE installed at /ServiceNow/Forward Field Integration CMDB Netgear CI
```

Success, no source change:

```text
Forward field integration NQE already current at /ServiceNow/Forward Field Integration CMDB Netgear CI
```

Success, source changed:

```text
Forward field integration NQE updated at /ServiceNow/Forward Field Integration CMDB Netgear CI
```

### 4. CMDB Schema Discovery

The script asks Forward to read the ServiceNow CMDB schema for:

```text
cmdb_ci_netgear
```

Forward uses `SN_INSTANCE_URL`, `SN_USERNAME`, and `SN_PASSWORD` for this ServiceNow schema read.

### 5. CMDB Mapping

The script maps Forward NQE columns to ServiceNow CMDB fields.

| Forward NQE Column | ServiceNow Field |
| --- | --- |
| `Name` | `name` |
| `Manufacturer` | `manufacturer` |
| `Serial Number` | `serial_number` |
| `Model ID` | `model_id` |
| `Location` | `location` |
| `Fully Qualified Domain Name` | `fqdn` |
| `DNS Domain` | `dns_domain` |
| `Device Type` | `device_type` |
| `IP Address: Management` | `ip_address` |
| `MAC Address: Management` | `mac_address` |
| `Ports` | `ports` |
| `Estimated Bandwidth` | `bandwidth` |
| `Physical Interface Count` | `physical_interface_count` |

When `USE_STOCK_NQE=1`, `Device Type` is omitted because the stock query emits it as an enum and many stock ServiceNow lab instances expose `device_type` as a string.

### 6. CMDB Enablement

The script writes Forward ServiceNow CMDB configuration and enables CMDB sync for:

```text
NETWORK_ID
```

Success:

```text
Forward CMDB configured for network <id> with <count> mapped fields
CMDB query: /ServiceNow/Forward Field Integration CMDB Netgear CI (<query id>)
ServiceNow ticketing and CMDB integration complete
```

## Verify

Read-only verification:

```bash
npm run verify:forward
```

Expected JSON contains:

- `ticketing.ok: true`
- `cmdb_configuration.ok: true`
- `cmdb_status.ok: true`
- `cmdb_history.ok: true`

Trigger one CMDB sync intentionally:

```bash
export PUSH_CMDB=1
npm run verify:forward
```

## Troubleshooting

### Forward ticketing points at the wrong ServiceNow instance

Rerun the installer. It detects immutable `instanceUrl` drift and recreates the Forward ticketing integration.

### NQE validation fails

Confirm the network has a processed snapshot and that the packaged NQE source compiles in the Forward NQE editor.

### CMDB schema has no mappable fields

Confirm the ServiceNow integration user can read `cmdb_ci_netgear` and dictionary metadata.

### CMDB sync should target another ServiceNow class

Update `CMDB_CLASS` and the field map in `scripts/configure_forward_integrations.py`, then run the script again in a change window.
