# Production release procedure

## Current release status

This repository is a source kit, not a published application release. The PDI application uses that instance's
`x_931473_` development prefix and is acceptance evidence only. Do not publish it, reuse its scope ID, or promote it
outside that PDI. Until Forward has a registered vendor prefix, all external distribution remains blocked.

## One-time setup

1. Confirm the permanent, registered application scope and generate the SDK project once.
2. Commit the generated `now.config.json`, lockfile, and Fluent `src/fluent/generated/keys.ts` file to the
   customer-controlled application repository.
3. Install ServiceNow IDE 4.1.1 or newer from the ServiceNow Store on every development/test instance that receives
   SDK deployments. The instance-side IDE handler is required to process the application package.
4. Create a non-human OAuth client for the build runner. Store its client ID and secret only in the CI secret manager.
5. Configure separate development, test, and production application-repository entitlements. Production may install
   only a version promoted from the tested release.

## Pull-request gate

Run `npm ci`, `npm run validate`, `npm audit --omit=dev --audit-level=high`, `npm run build`, and
`npm run build:ci`. The last command freezes Fluent keys and rejects metadata conflicts, preventing CI from silently
rewriting application identifiers.

The checked workflow also retains the generated application metadata, lockfile, and build output as a short-lived
release-evidence artifact. That artifact is validation evidence, not a distributable application package.

## Non-production deployment

Use OAuth client credentials only in CI. The ServiceNow SDK supports `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL`,
`SN_SDK_INSTANCE_URL`, `SN_SDK_AUTH_TYPE=oauth_client_credentials`, `SN_SDK_CLIENT_ID`, and
`SN_SDK_CLIENT_SECRET` for this purpose. Build, install with the generated `npm run deploy` command, and then run ATF,
Instance Scan, ACL/cross-scope negative tests, and a checksum-bound evidence-ingest acceptance test.

The generated deploy command always sets `--demoData false --reinstall false`. Do not add `--reinstall` to a routine
deployment: it can remove instance metadata not present in the package.

## Production promotion

Publish only the exact non-production-tested version to Application Repository. Restrict entitlements to the intended
production instance, install through **My Company Applications**, and record the release version, source commit,
approval, ATF/Instance Scan results, and acceptance-test receipt. Rollback is a new approved application release;
never use a destructive reinstall as rollback.
