# 0623: Agents, slice 2: email, AP Managers as recipients, each copy their own

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0128`** and **vf-licence migration `0266`** (strings). Deploy vf-licence,
then vf-app and vf-ui. Email uses the Resend secrets already set for
route alerts and supplier returns (`RESEND_API_KEY`,
`RESEND_FROM_ADDRESS`); without them the Agents screen says email is not
set up and offers the task list only.

## What was asked

Slice 2 of the six agreed with Dan on 4 October 2026
(`claude/agents-design.md`), after slice 1 (0622) went live and Dan
tested it: *"tested this and seems okay"*, *"next slice?"*. The
decisions it carries out, agreed the same day:

- **Recipients** are the author, or people with the AP Manager
  permission; no outside addresses (people forward from their own email).
- **Each copy is filtered** to the recipient's organisation permissions.
- **Each recipient's own language.**
- **Any recipient can stop it**; the author sees who did.
- **The full report sent is kept 13 months.**

## What was built

### vf-app

- **Migration `0128`**: `agents.deliver_task` (default on) and
  `deliver_email`; `agent_recipients` (author always, opted-out time
  kept), back-filled with each agent's author; `agent_deliveries`, one
  row per person per channel per run, with Resend's id and where the
  copy sent is kept.
- **Making and editing**: `deliver` `{task, email}` (at least one) and
  `recipients`, refused unless each holds `AP.Manager`; the author is
  always one. Editing keeps whether someone stopped it.
- **A run, per recipient** (`runAgent`): the organisations are the
  chosen ones the author can still see **and** the recipient can, and
  the report is gathered **with the recipient's own access**, so nobody
  is sent a number they could not see in the app. Someone who stopped
  it, or no longer holds `AP.Manager` (the author apart), gets nothing;
  an empty report for one person sends that person nothing. Run now
  goes to the author alone.
- **Email** (`agent-email.ts`): subject *name · day*; the report's name
  and as-at time in the environment's zone; organisations the author
  lost, and a line where the copy is filtered for this reader; the table
  (200 rows at most, the rest named and in the CSV); totals; *Open
  VibeFinance*; why they get it and, for anyone but the author, *Stop
  sending me this*. Text and HTML, English or German by
  `org_users.locale` (else the environment's `LOCALE`). The **CSV**
  attached carries every row, headings in the language, numbers plain,
  and any cell a spreadsheet would read as a formula written as text.
  `sendEmailViaResend` gained `html` and `attachments`.
- **Kept**: each email's copy (subject, text, HTML, CSV) in the
  documents bucket under `agents/<agent>/<run>/<person>.json`;
  `purgeOldAgentRecords`, on the five-minute tick, removes runs,
  deliveries, notes and copies older than 396 days, 200 runs at a time.
- **A run's outcome**: delivered when anything was sent (a failed email
  beside a sent note is said on the run); failed when everything failed,
  e.g. `email_not_configured` or `no_email_address`; nothing when every
  copy was empty.
- **Routes**: `POST /agents/:id/stop` for any signed-in recipient (the
  author is told to pause or remove instead); `GET /agents` adds
  `managers` and `emailReady`; each agent its `deliver` and
  `recipients`; `GET /agents/:id/runs` each run's deliveries;
  `GET /agent-notes` says `canStop`.

### vf-ui

- **The form**: *Delivered* (task list, email; email unavailable and
  said where it is not set up) and *Also send to* (AP Managers, those
  without an address said).
- **Each agent's row** says how and to whom, who stopped it included;
  **Runs** say each delivery, failures with why.
- **From agents**: *Stop sending me this* on a note from someone else's
  agent.
- **The link in an email** (`/?stopagent=<id>`): once signed in, the
  agent is stopped for that person, it is said at the top of the first
  screen, and the address is cleaned.

## Not built (later slices)

Ageing buckets, due soon and not yet eligible, stuck work, thresholds,
comparison with the last run (slice 3); plain words (4); the AI summary
(5); the agent's own page (6). An email link straight to Documents at the
report's filter waits for slice 3's filters.

## Verification

- **`vf-app`** `agents-email.test.ts`, 11 tests: author always, AP
  Managers only, at least one channel, managers offered; each copy only
  the organisations its reader may see; email in each reader's language
  with the CSV (German headings, the row), the stop link for all but the
  author, the copy kept in R2 and Resend's id recorded; email not set up
  failing an email-only run and recorded beside a sent note; Run now to
  the author alone; stopping (author refused, a stranger told), then
  nothing for them and shown to the author; a recipient no longer an AP
  Manager; the stop route through the router for a recipient who makes
  no agents; the 13-month purge, copies included; 200 rows and the rest
  in the CSV, a formula written as text, HTML escaped, German number
  format. `agents.test.ts` and `agent-schedule.test.ts` unchanged and
  passing.
- **`vf-ui`** browser `agents.test.ts`, 5 new: how and to whom in the
  row; the form's channels and recipients sent; no email where not set
  up; stopping from a note, not one's own; the email link stopping it
  once signed in. Worker: the stop path proxied.
- **`vf-licence`** 359 of 359 (26 new keys covered).
- **Full runs**: vf-app 3521, of which 3519 pass (the two known
  failures); vf-ui browser 1516, of which 1515 pass (the known
  `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  worker 111 of 111; vf-licence 359 of 359. **Migrations** replay:
  vf-app 128, vf-licence 266.
