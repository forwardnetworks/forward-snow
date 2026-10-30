# Native Forward features on the Brazil release: path search, Predict, Maps, Forward AI

## Goal

Add Forward features to the scoped application that the NetBox plugin already has (Predict, Maps, change control,
Forward AI awareness) using what ServiceNow provides natively on the Brazil release. Forward is called from the
instance itself. The assurance worker keeps its current job (evidence gathering, hashing, gating) and is not required
for these features.

This restores a capability the repository had until commit `9df81bc`, when a direct `ForwardClient` (path search over
`RESTMessageV2`, credentials in a binding table) was removed along with the demo installer. That commit narrowed the
repository to one scoped application and deleted everything tied to the global `x_fwd_demo` namespace, which is where
`ForwardClient` lived. Its message does not say that dropping direct Forward calls was intended, so treat it as a side
effect of the narrowing. The replacement must not bring back stored passwords or a global scope.

## Parity target

Parity with forward-netbox means the features it ships for a change, not its device sync: path search, Network Maps,
change control around the Change Request (policies, approvals, validation runs, verdict), Predict with a proposal
per device, and Forward AI detection. Out of scope: NetBox-specific inventory sync, branching and the NQE data maps
that feed NetBox models.

Phases, each shippable on its own: (1) client and path search, (2) Maps, (3) Predict, (4) change-control parity
(policies, reviewer rules, validation runs), (5) Forward AI detection.

## Verified on the target instance (dev PDI, 2026-10-30, read-only)

- Build `glide-brazil-08-25-2026__patch0-08-26-2026`.
- ServiceNow IDE 5.0.2 (`sn_glider`) and the ServiceNow IDE Platform plugin are active. The kit's floor is 4.1.1.
- Flow Designer (`sn_flow_designer` 30.0.7) and Integration Hub designer (`sn-integrationhub-designer` 27.0.7) are
  installed. Licensing was not checked, so the design uses neither Integration Hub spokes nor its REST step.
- Connection and credential tables exist: `sys_alias`, `sys_connection`, `http_connection`, `basic_auth_credentials`,
  `oauth_credential`.
- Basic auth is restricted: `glide.authenticate.basic_auth.restriction.enforce` and `.active` are `true`, allowed only for
  the role `snc_basic_auth_api_access`. REST calls with a user password returned 401 while the web login worked.
- The SDK alias for this instance is OAuth and was created by SDK 4.14.0. SDK 4.9.0, which the kit used to pin, could not
  see it. The kit now pins 4.14.0.

## Constraints

- Forward credentials live only in a Connection & Credential alias bound at install time, never in a custom table, a
  system property or the package. The existing connection posture in `docs/customer-managed-scoped-app.md` applies.
- Every Forward write (Predict creates a change set) needs an explicit operator confirmation and an opt-in setting,
  as in forward-netbox. A prediction is advisory: no gate, close guard or rule reads it.
- Predict and change-set routes are not in Forward's published API description. The forward-python-sdk spec lists them
  as unpublished but used by the NetBox plugin. The JavaScript client must treat their shapes as less stable.
- Proposed CLI can contain keys and SNMP communities. Store it in its own table with auditing off, never in work
  notes, journal fields, events or the evidence bundle.
- Actions that write records use `GlideRecordSecure`, which applies the caller's ACLs only when the flow runs as the
  user. Flows that call them must not run as System.
- A long Predict must not block a transaction. Polling runs in a Flow Designer subflow or scheduled job.
- Inbound calls to the existing ingest resource must not rely on basic auth (see Open questions).
- No customer identifiers in the repository, tests or docs. Fixtures are synthetic.

## Approach

1. **Forward API client (script include).** A small client over `sn_ws.RESTMessageV2` that takes the bound `Forward API`
   alias, requires an exact HTTPS origin, sets timeouts, caps response size and maps HTTP errors to typed failures
   (unauthorized, forbidden, not found, rate limited, server, unreachable, invalid response, invalid request). Errors
   carry the kind and status, never the response body. It carries no business logic. The shapes it relies on
   come from the forward-python-sdk OpenAPI spec, not from memory.
2. **Path search (read).** `GET /networks/{networkId}/paths` as before, now through the client, as the `Check Forward
   Path` action. The verdict goes on the existing path-validation record: `allowed` needs one DELIVERED and PERMITTED path;
   `blocked` needs every path seen with every outcome stated; anything cut off or incomplete is an error, not a verdict.
   The snapshot searched is the newest processed one by creation time (Forward's own rule), or one the caller pins, and
   is recorded on the record. This is the smallest slice and proves the client, alias and ACLs on Brazil.
3. **Maps panel (read-only).** A related list on the Change Request showing Forward Network Maps whose name matches the
   configuration item's location or service, with a short-timeout cached read. A refusal or failure shows a note, never
   an error. The exact endpoint is to be confirmed from the SDK source before work starts.
4. **Predict (advisory).** A proposal table (change, device, commands, digest), a subflow that runs change set, validate,
   stage, commit, predict, then a refresh action that polls the predicted snapshot until processed. Order and error
   handling follow `docs/03_Plans/active/2026-10-27-change-control-predict-scaffold.md` in forward-netbox. Cleanup deletes the
   change set when the change closes or is cancelled. Cleanup is best-effort and never blocks a state change.
5. **Forward AI.** Detect only, as in forward-netbox. Calls to the chat routes are out of scope for this plan.
6. **Packaging.** New tables, roles and ACLs go in the Fluent source (`servicenow/scoped-app-template/src/fluent/`).
   Shared logic goes in `servicenow/assets/` so the existing generator renders it and the Node tests can load it.
7. **Tooling.** `SDK_VERSION` is pinned to 4.14.0 (done); the generated project must still be built to confirm it.

## Validation

- `npm run validate` (the project's gate) must pass with a non-zero test count. New client and subflow logic gets
  Node tests that fake `sn_ws.RESTMessageV2` and `gs`, derived from the requirements above, not from the code.
- CI's generate-and-build step (`npm run build`, `npm run build:ci`) must pass on the generated project.
- On the PDI: install the built app, create the alias, run path search against a Forward network and record the result.
- **Not verified yet:** any call to a live Forward from ServiceNow, Predict on a licensed org, and whether the Flow
  Designer pieces behave as designed on Brazil. The Predict live check done for forward-netbox used the Python SDK, not
  this client.

## Known limits

- A network with 500 or more processed, unarchived snapshots cannot use "latest": the snapshot list is refused rather than
  guessed at, so the caller must pin a snapshot. A very low `forward.max_response_bytes` can also refuse a long list.
- The `Check Forward Path` action refuses to run as System. Its calling flow must run as the user.

## Open questions

- Does the existing Scripted REST ingest resource authenticate with basic auth? If so, it needs OAuth or a role-based
  approach on Brazil. Check `servicenow/assets/ChangeAssuranceIngest_Resource.js` and its security definition.
- Does the assurance worker's own ServiceNow auth profile (`ChangeAssuranceFlowClient`) use basic auth for the
  outbound call? That is for the worker's endpoint, so it is unaffected, but confirm.
- Which Maps endpoint, and which ServiceNow field the map name should be matched against.

## Rollback

Each feature is additive: new tables, a script include, and subflows. Maps stays inert until `forward.network_id` is set
and can be switched off with `forward.maps_enabled`; Predict will ship behind an opt-in setting that defaults to off.
Uninstalling the app removes the rest.
