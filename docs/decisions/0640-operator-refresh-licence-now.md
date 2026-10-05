# 0640: Refresh now: a licence change reaches its environment at once

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-admin` only. No migration. Deploy vf-admin.

## What was asked

Dan changed Acme's licence to 10 agents, and Acme's screen still said 5.

- An environment reads its licence from the control plane every six hours
  (its cron), or when asked at `POST /licence/refresh` (decision 0004's
  pattern).
- That took a `curl` from Dan.
- I offered a button. Dan: *"yes, do the refresh please"*.

## What was built

### `POST /api/environments/:id/licence-refresh` (vf-admin)

- **Behind Access** like every operator route. It needs the admin key,
  because it reads the fleet.
- **Where to ask is the control plane's record, never the caller's.** The
  caller names only the environment's id. vf-admin reads the fleet
  overview from vf-licence with the admin key, and takes that
  environment's `instanceUrl`, which must be https. It then asks
  `<instanceUrl>/licence/refresh`, with a 10-second limit.
- **The environment fetches and checks the signed token itself**, as on
  its cron. Nothing here carries a licence or a key to it.
- vf-admin already has `global_fetch_strictly_public`, so another
  Worker's workers.dev address is reached over the public internet
  rather than refused (decision 0005's 1042).
- **It says what came of it:**
  - **refreshed**, with the plan and state the environment now holds;
  - `not_deployed` (409);
  - `unknown_environment` (404);
  - `unreachable` (502);
  - `not_refreshed` (502), with the environment's own reason, such as a
    signature that did not check.

### The console

- **Refresh now** on each deployed environment's row, beside Licence and
  Config. It says *"Acme-production now holds its licence: standard,
  active."*, or why not, and that the environment reads its licence again
  within six hours anyway.
- **Saving a licence refreshes the environment straight after**, so the
  button is only needed when something else changed.
- The buttons column is wider to fit the third button.

The refresh is not in the admin log. That log is the control plane's
record of its own actions, and a refresh changes nothing there. The
environment only re-reads what the log already recorded when the licence
was saved.

## Verification

- **`vf-admin`** 17 of 17, 3 new tests:
  - asked at the recorded address, with the admin key on the fleet read,
    saying what it now holds;
  - not deployed, unknown, unreachable, and not refreshed with the
    environment's reason;
  - refused without Access, and an operator route with it.
- **Drawn in a browser** with stub data: the button on the deployed row
  only, and the line after it is pressed.
