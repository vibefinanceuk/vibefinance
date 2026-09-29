# 0556 — Routes, slice 2: the Route monitor

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0207`** (strings). No `vf-app` migration.

## What was asked

Slice 2 of the Routes design (`docs/design/routes-phase1-data-model.md`
section 7): the Route monitor screen, as mocked up and agreed, reading the
messages 0555 now records, with its own permission for a customer's IT
team.

## What was decided

- **A new permission, `Integration.Monitor`**, in a new `Integration`
  group on the Access screen. It opens the Route monitor and nothing else:
  an IT team can watch the connections without approving or coding
  anything. `Integration.Configure` waits for slice 3, when there are
  routes to configure. It is not a stage permission, so 0104's standing
  invariant on `process_stages.required_permission` rightly keeps
  excluding it, and no migration restates it.
- **Not scoped by unit.** A mailbox serves the whole customer, not one
  org. Invoices a message made are named by number, and not opened from
  here: opening one is `AP.*` work, scoped as before.
- **Three read-only routes** (`vf-app`, proxied by `vf-ui`):
  - `GET /route-messages?source=&status=failed&period=today|7d|30d`: up to
    200 messages, newest first, with the four counts and the sources to
    filter by, in one answer. `source=none` is mail no source claimed.
  - `GET /route-messages/:id`: the message, its parts (never their R2
    keys), its history and the invoices it made.
  - `GET /route-messages/:id/parts/:seq`: one stored file, streamed from
    R2 as a download, never shown inline (`nosniff`): it is somebody
    else's file, and an HTML attachment rendered on this origin would run
    as this app.
- **D1 answers the screen; R2 only the file asked for.** The list, counts
  and detail come from 0555's small D1 rows. R2 is read only when someone
  downloads a file.
- **The four counts** are always today and every source, whatever the list
  is filtered to, because they answer "is anything wrong right now":
  - *Received today*;
  - *Delivered today* (delivered or partly delivered);
  - *Failed, not yet fixed*: every failed or partly delivered message
    from any day (dismissing comes in slice 5);
  - *Waiting over an hour*: a message still in progress an hour after it
    arrived, which means something stopped half-way.
- **The screen**, last in the Integration menu group (after ERP export, so
  no screen changes colour, 0527):
  - the four counts, a failure or a wait shown in colour only when there
    is one;
  - the messages, with filters by route (and "Unknown address"), Failed
    only, and Today / 7 days / 30 days, each asking the server again;
  - a failed row tinted; each row's route, sender, subject, what it made
    ("→ invoice INV-3110", "→ 2 invoices", "no invoice made"), status and
    where it failed;
  - one message opened beside the list:
    - the route's five parts (Gateway, Format, Translation, EN 16931,
      Process) as Done, Partly, Failed or Not reached, worked out from
      the status and the part that failed;
    - **what went wrong in words, and what to do**, from strings keyed by
      the error code (the words are the interface's, 0132), with a
      general explanation for a code it has no words for;
    - the technical detail: the code and each failed file's own reason;
    - the invoices it made;
    - its original files, each a download: the email (saved as
      `MSG-….eml`) and each attachment under its own name;
    - its history, with local times.
- **The pale status fills keep Day's colours in both moods**, so their
  words use the dark value text, as 0528's card does.
- Strings in English and German (`vf-licence` `0207`), including page help
  for the Help panel.

## Not built / worth knowing

- **Reprocess and dismiss** are slice 5; the message's stored parts are
  what reprocess will run from.
- **Only email** appears: the HTTPS capture route is not yet a route
  message (0555).
- Someone holding only `Integration.Monitor` lands on Tasks at sign-in,
  as anyone without `AP.Dashboard` does, and then opens the monitor from
  the menu.
- The list shows the 200 most recent in the period.

## Verification

- **`vf-app`** `route-monitor.test.ts` (8): the list with outcomes, sender
  and what each made; filters by failure, source and unclaimed mail;
  today, 7 and 30 days (an unknown period is today); the four counts,
  including yesterday's failure and a message stuck over an hour but not
  one ten minutes old; one message's parts, history and invoice, with no
  R2 key; a 404; a part downloaded as it arrived, `attachment` and
  `nosniff`; a 404 for a part never stored.
- **`vf-app`** `index.test.ts`: through the real router, 403 without
  `Integration.Monitor` (even with `Admin.Configure`), the list, one
  message, 404s, and 405 for a POST.
- **`vf-ui`** `route-monitor.test.ts` (browser, 7), with the real English
  strings read from migration `0207`: counts, rows and outcomes; each
  filter asking the server; a failed message's parts, explanation, fix,
  technical detail, files and history; downloads under their own names;
  Close; an empty period; the part states for each status.
  `tasks.test.ts`: someone holding only `Integration.Monitor` sees Route
  monitor under Integration, and no ERP export. `index.test.ts`: the
  three paths are proxied.
- With the previous production files, the router test and the menu test
  failed.
- `vf-licence` string coverage lists all 81 keys; `vf-licence` 322/322;
  replay 207, all assertions held.
- **`vf-app`**, a full, unfiltered run: 136 files and 3237 tests, of which
  **3235 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511). One of them, `stage-permissions` "names
  exactly the permissions the code defines", compares the stage-permission
  invariant with every permission; `Integration.Monitor` is deliberately
  not a stage permission, as `AP.Export` was not.
- **`vf-ui`**: worker 75/75; browser 1318/1319 (the known
  `typography.test.ts` 10px gap).
- Day and Night screenshots of the real screen, a failed message open,
  checked by eye.
