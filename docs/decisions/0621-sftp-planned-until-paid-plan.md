# 0621: SFTP out and SFTP in planned again, until the Workers Paid plan

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared` only (the library), with tests in `vf-app`. No
migration. Deploy vf-app (it bundles `shared`); vf-ui reads the library
from vf-app and needs nothing.

## What happened

Decision 0620 was pushed (`365b882`) and Dan deployed vf-licence, vf-app
and vf-ui and applied migrations `0126` and `0263` on 3 October 2026.
Deploying **vf-sftp** then failed in three steps on Dan's Mac:

1. `Could not resolve "@cloudflare/containers"`: the new package was not
   installed yet; `npm install` at the repository root fixed it.
2. `The Docker CLI is needed`: Docker Desktop was not running yet.
3. The image built, but its upload to Cloudflare's registry answered
   **Unauthorized**, also after signing in again with `containers:write`.
   The account is on the free plan, and **Containers need Workers Paid**.

0620's own record and deploy notes said Workers Paid was needed, but not
plainly enough that it is a paid upgrade that must come first.

## What was decided

Dan, 3 October 2026: *"As this is not on the critical path, lets park
until a customer really needs it"*, and then, asked whether the library
should stop offering SFTP: *"yes, update as planned"*.

- In `shared/connectors/library.ts`, **SFTP out** and **SFTP in** are
  `planned` again, without the *First version* mark. The Route library
  shows them as Planned with no *Add to my routes*, and
  `handleCreateDestination` refuses SFTP out (`not_available`), as for
  any planned connector.
- **Everything else from 0620 stays**: vf-sftp's code, vf-app's SFTP
  routes and delivery branch, the settings card, the strings, and
  migration `0126` (the `sftp-out` route and SFTP in's live version).
  None of it runs without an SFTP route instance, and none can now be
  added from the library. Reverting the migration would only have to be
  undone again.
- vf-app's `SFTP_SERVICE` binding is left in place. Without a running
  container each SFTP call answers *the SFTP service could not be
  reached* (`runner_unavailable`).

## To take it up again

1. Upgrade the Cloudflare account to Workers Paid.
2. With Docker running: `npm install` at the root, then
   `cd workers/vf-sftp && npx wrangler deploy`.
3. Redeploy vf-app, so `SFTP_SERVICE` reaches the deployed vf-sftp.
4. Set both connectors back to `available`, `maturity: "first_version"`,
   and the two library tests with them.
5. Try SFTP in against `test.rebex.net` (read-only: test and list only),
   and SFTP out against a server that can be written to.

## Verification

- **`vf-app`** `connector-library.test.ts`: SFTP out and SFTP in listed
  as planned; adding SFTP out refused as `not_available`.
  `sftp.test.ts` adds SFTP out from a library with it available, so the
  0620 behaviour stays tested. Those two files and `routes.test.ts`: 29 of 29.
- **`vf-ui`** browser `routes.test.ts`, `sources.test.ts`,
  `lookup-lists.test.ts`: 106 of 106 (they use their own library data).
- **`shared`** 436, of which 432 pass and 1 is skipped (the three known
  failures).
