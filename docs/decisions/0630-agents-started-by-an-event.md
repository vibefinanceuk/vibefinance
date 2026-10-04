# 0630: Agents phase 2, slice 3: agents started by an event

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0134`** and **vf-licence migration `0274`** (strings). Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

Phase 2's third slice, as Dan chose it (0628): agents started by an
event, the first four being **an invoice stuck N days at a stage, a
possible duplicate, an invoice from an unapproved supplier, and a
supplier file that failed**, delivered **gathered, at most hourly**.
Dan: *"please proceed with slice 3"*.

## How

Nothing in the app announces these as they happen, and four separate
hooks into capture, matching and the workflow would be four places to
forget. Each of the four is already a list the app can read (stage
visits, Fraud Prevention's two checks, the Route monitor's messages). So
an event agent is an agent whose report is **that list, looked at every
hour, less what each person has already been sent**. A burst of thirty
duplicates is one message; an hour with nothing new sends nothing and
keeps no run.

## What was built

### vf-app

- **Four event reports** (`event: true` in `AGENT_REPORTS`), each row
  carrying a `_key` for what it is about:
  - `event_stuck` (AP.Analysis): invoices in progress, short of their
    exit stage, at their current stage longer than `stageDays` (1–90,
    default 3); org, invoice, supplier, stage, days at stage, total.
    Keyed by the stay at the stage, so an invoice that leaves and comes
    back is told again.
  - `event_duplicate` (AP.FraudReview): Fraud Prevention's possible
    duplicates, keyed by invoice.
  - `event_unapproved_supplier` (AP.FraudReview): Fraud Prevention's
    unapproved-supplier invoices, with why (*not on file* or *on hold*,
    in words in the email, CSV and note), keyed by invoice.
  - `event_file_failed` (Integration.Monitor): received files the Route
    monitor shows as failed or partly read in the last 14 days; received,
    from, subject, what went wrong. Not tied to an organisation.
- **Every hour**: an event report's schedule is `{ every: "hour" }`,
  set by the server whatever is sent; `nextRunAfter` is an hour on.
- **Only what is new, per person.** Migration **`0134`**:
  `agent_seen(agent, person, key, sent_at)`. Each copy drops the keys
  that person was sent; what is left is sent, and marked only once a task
  note is made or an email goes, so a failed email is sent again next
  hour. Totals are of what is sent; no comparison with last time. Kept
  13 months, purged with the runs.
- **An empty hour leaves no run**, so the agent's page shows what was
  sent, not twenty-four nothings a day.
- **The first time**, it sends what there is now (said on the form).
- **Plain words** know the four (`EVENT, when …`); an event report needs
  no time, and *as soon as* is not refused as too often.
- Email words for the four reports, their columns and reasons, English
  and German.

### vf-ui

- **The form**: choosing an event report replaces the time with *Every
  hour, when there is something new* and why; choosing another brings a
  time back. Stuck invoices offer *At one stage longer than (days)*.
- **Ready-made**: *Tell me when an invoice is stuck*, *Tell me about
  possible duplicates*, *Tell me when a supplier file fails* (each
  offered only with its report's permission).
- **A note** says why in words (*Supplier not on file*).
- Invoice rows open in Documents (0629) as other rows do.
- Help lines 31 and 32.

## Not built

AR agents, and a *bank details changed* event, wait as Dan chose (0628).
Past due, accruals and team workload still open nothing in Documents
(0629).

## Verification

- **`vf-app`** `agents-events.test.ts`, 5 tests: an event agent saved
  hourly whatever was asked, with its option; only invoices past the
  days, sent once; an hour with nothing new sends nothing and keeps no
  run; one crossing the line later sent alone; a new stay at the stage
  told again; each person's own record, nothing marked while email
  failed and sent the hour after, then not again; an unapproved supplier
  said in words in the email; failed and partly read files of the last
  two weeks only; plain words with no time and no *too often*.
- **`vf-ui`** browser `agents.test.ts`, 4 new: no time asked and saved
  hourly with its days; a time back when the report changes back; the
  ready-made one, every hour in the plan; why in words on a note.
- **Full runs**: vf-app 3557, of which 3555 pass (the two known failures); vf-ui browser 1539, of which 1538
  pass (the known `typography.test.ts` 10px gap), with the same 331
  unhandled errors; worker 111 of 111; vf-licence 360 of 360.
  **Migrations** replay: vf-app 134, vf-licence 274.
