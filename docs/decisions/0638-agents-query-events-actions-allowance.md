# 0638: Agents ask the data, slice 5: questions started by an event, actions from questions, and the day's allowance

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui`, `vf-licence`, `vf-admin` and `shared`. It
needs **vf-app migration `0137`** and **vf-licence migrations `0283`**
(the licence's number) **and `0284`** (strings). Deploy vf-licence, then
vf-app, vf-ui and vf-admin.

## What was asked

Slice 5 of the query layer as agreed (0633):

- events and actions on a question;
- the licence switch and daily allowance (Dan: *"a switch, on by default,
  with a daily allowance per tier"*);
- indexes where runs are slow;
- the simple reports moved onto questions.

Dan, after 0637 went live: *"Please go ahead with slice 5"*.

## What was built

### A question started by an event

- **A question may say `event: true`.** It is then looked at every hour,
  and each person is sent only the rows they have not had. This is the
  same as the event reports in decision 0630: each row's key
  (`q:<row id>`) goes into `agent_seen`, and an hour with nothing new
  leaves no run behind.
- **The rows must be one each**, so each has its own key. A grouped event
  question is refused (`query_event_grouped`).
- **Saving an event question gives it the hourly schedule**, whatever
  schedule was sent, as for an event report. Each run, the author's copy
  and each recipient's are treated as an event report's.
- **Plain words write an event question** for *"as soon as"*, *"whenever"*
  and *"when … happens"*, with the hourly schedule and no *too often*
  refusal.

### Prepared actions from a question

- Each action names the datasets whose questions can prepare it
  (`AGENT_ACTIONS[kind].datasets`):
  - **reminding whoever holds a task** (0631): questions of invoices,
    tasks or time at stages;
  - **chasing a supplier** (0632): questions of returns.
- They are prepared from the invoices in the author's copy, exactly as
  for the reports, with the same checks, approvals and lapsing.
  `checkAction` takes the question's dataset, and refuses anything else
  (`action_not_for_report`).
- The catalogue on `GET /agents` gives each dataset its `actions`, so the
  form offers them.

### The day's allowance, on the licence

- **`queryLimit` on the licence**: the questions an environment may ask a
  day.
  - Each run of a question takes one, for each person's copy, and so does
    each *Try it now*.
  - Blank means the default of 500. **0 leaves questions out of the
    tier**: the switch.
  - It is a new `licences.query_limit` column (vf-licence `0283`), and is
    in the token only when set.
  - It is checked by shared's claims check, shown on the operator views,
    and edited in vf-admin as *Own questions a day (blank: default, 0:
    none)*.
- **vf-app `0137`** adds `agent_query_days`. Each one is taken in a single
  statement, so two runs at once cannot both take the last. Past the
  limit:
  - Try says *today's questions are used* (`query_limit_reached`);
  - a run fails with the same reason, and the author is told as for any
  failing agent (0627).
- **Where the licence says 0:**
  - there is nothing to ask in the catalogue;
  - *Your own question* has no organisations;
  - saving one is refused (`query_not_in_licence`).
- `GET /agents` says today's questions against the limit, and the builder
  shows it under *Try it now*.

### Indexes (vf-app `0137`)

These cover the paths the questions use most:

- stage visits by instance and time (time at stages, when an invoice
  moved on);
- deliveries by invoice and status (at the ERP, and the deliveries
  dataset);
- purchase order pairings by order and line (*invoiced*);
- process instances by status and end (returns);
- invoices by organisation and when received ("only what is new").

### Ready-made questions, and the simple reports

**Four ready-made questions** in the library, to use as they are or
change in Edit steps:

- *Large invoices*: over £100,000 still in process, Mondays.
- *Spend by GL code*: the last month's coded spend, at month end.
- *Slow stages*: average and longest days at each stage over 30 days,
  Mondays.
- *Failed deliveries to the ERP*: as soon as one fails.

Each is offered only where its dataset may be asked about, with that
dataset's organisations.

**Not done as agreed: the simple reports were not rewritten as
questions.** Open tasks by person, Stuck work and Due soon stay as code:

- Each has something a question cannot yet say:
  - the unclaimed tasks row;
  - highlights at twice the days;
  - reminders found from stuck tasks.
- Rewriting them would change what agents already set up are sent.

The ready-made questions give the same ground in a form that can be
changed. If Dan still wants the three moved, that needs highlights and
the unclaimed row added to questions first. This is the one point in this
slice that departs from what was agreed, and it is said in the reply.

### The builder (vf-ui)

- **When**: on its schedule, or as soon as something new matches. The
  second is not offered while grouped, and grouping turns it off. An
  event question shows *Looked at every hour*, as an event report does,
  and does not ask "only what is new". In words: *as soon as something
  new matches, looked at every hour, each person sent only what they have
  not had*.
- **Also prepare**: the actions the question's dataset can prepare.
- **The day's questions** under *Try it now*.
- **Help line 42**, and the new words, in vf-licence `0284`.

## Verification

- **`vf-app`** `agents-query-events.test.ts`, 5 tests:
  - an event question saved hourly, sending the one large invoice, then
    nothing and leaving no run, then only the new one;
  - a grouped event question refused;
  - a lines question refused a reminder, while an invoices question
    prepares one for the task Uma holds. Returns offer chasers and tasks
    reminders;
  - with a limit of 2: two tries, then *used*; the list says 2 of 2; a run
    fails saying why; the next day starts again;
  - with 0: no question saved, nothing in the catalogue, and no
    organisations for *Your own question*.
- **`vf-licence`** token test: `queryLimit` absent by default, refused
  when negative or fractional, then 1000, then 0. The operator views test
  includes it.
- **`vf-ui`** browser `agents.test.ts`, 3 new tests and 1 changed:
  - an event question built, not while grouped, and saved hourly;
  - a returns question offered chasers;
  - ready-made questions only where their dataset may be asked about,
    filled in the builder;
  - the library list includes *Large invoices*.
- **Full runs**:
  - vf-app 3600, of which 3598 pass (the two known failures);
  - vf-ui browser 1555, of which 1554 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 362 of 362;
  - vf-admin 14 of 14;
  - shared 436, of which 432 pass and 1 is skipped. These are the three
    known failures; the two in `licensing/token.test.ts` fail the same
    way without this change.

  **Migrations** replay: vf-app 137, vf-licence 284.
