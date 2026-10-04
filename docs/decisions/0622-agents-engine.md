# 0622: Agents, slice 1: the engine, made from a form, delivered to the task list

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui`, `vf-licence` and `vf-admin`. It
needs **vf-app migration `0127`** and **vf-licence migrations `0264`
and `0265`**. Deploy order: vf-licence, then vf-app, vf-ui and vf-admin.

## What was asked

Dan, 4 October 2026: an agent as a process-wide activity, where a rule
is a stage-specific one. *"Create an agent that creates a report on
outstanding payables by supplier, and the agent can be executed on a
configurable schedule, daily, weekly, monthly, a specific time - and
also configure the output to an email address or just a users task list
for example. This would be limited to AP Managers."*

The design, mock-ups and cost were written up and agreed the same day:
the Agents page (artifact) and `claude/agents-design.md` in the
project. Dan answered the fifteen open questions; this is slice 1 of the
six-slice build order agreed there (*"Yes please, lets start"*).

## Decisions agreed with Dan (4 October 2026)

1. **Outstanding** is payment-eligible and **not yet delivered to the
   ERP** (*"payment-eligible is what we should track against"*; once the
   ERP has it, it leaves the report).
2. **Recipients** are the author or people with the AP Manager
   permission; no outside addresses (people forward from their own
   email). Email is slice 2; this slice delivers to the author only.
3. Each copy is **filtered to the recipient's organisation permissions**.
4. The **AI summary** is on by default (slice 5).
5. Deliveries are **in the task list**.
6. **"Agents" under Accounts payable.**
7. **Included in every tier, capped by tier**, the count carried by the
   licence on the control plane.
8. **An administrator can remove other people's agents** and retire the
   user account.
9. **Organisations are chosen when the agent is made**, and kept.
10. **One time zone per environment**; a missed run happens once, late.
11. Each recipient's **own language**.
12. The **full report kept for 13 months** (in R2 with slice 2's email;
    in D1 for now, below).
13. Any recipient can **opt out** (slice 2).
14. **First data**: outstanding payables; due soon and not yet eligible;
    stuck work and exceptions; fraud watch and accruals.
15. **The form stays** as "Edit steps" once plain words arrive (slice 4).

## What was built

### vf-app

- **Migration `0127`**: `org_settings.time_zone` (default
  `Europe/London`); tables `agents`, `agent_runs`, `agent_notes`;
  **`AP.Agents`** granted to every role holding `AP.Manager`.
- **`agent-schedule.ts`**: a schedule is kept as chosen
  (`day`, `workday`, `week` on a weekday, `month` on a day 1–28, the
  last day or the last working day, `once` on a date) in the
  environment's zone; `nextRunAfter` turns it into the next UTC moment,
  so "Monday 08:00" stays 08:00 across summer time. Nothing runs more
  often than daily.
- **`agents.ts`**:
  - **Reports** (`AGENT_REPORTS`), each with its own permission and
    run per chosen organisation with the author's access:
    **outstanding payables** (new: payment-eligible as the ERP export
    defines it, with no `destination_deliveries` row delivered, by
    organisation, supplier and currency, oldest due date first, with
    days past due); **past due, not yet payment-eligible** (the AP
    Expert's overdue balance); **accruals by stage**; **open tasks by
    person**, unclaimed included; **possible duplicates**
    (`AP.FraudReview`). The table carries column keys and kinds, so
    the reader's interface says it in their language.
  - **Making one**: name, report, organisations, schedule; refused in
    words where incomplete or where the author cannot see the report in
    an organisation chosen. Saved paused. **The licence's count**:
    `agentLimit` from the signed licence, else `DEFAULT_AGENT_LIMIT`
    (5); a removed agent frees its place.
  - **Start** works out the next run (a `once` already past is
    refused); **Pause** always works; **Run now** runs once, to the
    author, paused or not, leaving the schedule alone; **Remove** by
    its author or an administrator (`Admin.UserManagement`), its runs
    and notes kept.
  - **`runDueAgents`**, on the existing five-minute cron after the
    deliveries and in its own `try`: each due agent is **claimed** by
    moving `next_run_at` on in one conditional UPDATE, so an
    overlapping tick cannot run it twice; the next time is worked out
    from now, so a run missed during an outage happens once and is
    marked late (over 15 minutes after its time). At most 20 per tick.
  - **Each run checks again**: the author must still hold `AP.Agents`,
    else the run fails and the agent pauses (`author_access`); an
    organisation where they no longer hold the report's permission is
    left out and named on the report; with none left, it pauses too.
  - **Nothing to report sends nothing** (`nothing`), recorded on the run.
  - **Notes**: a delivered report is an `agent_notes` row for its
    recipient, **its own table rather than a task**: it belongs to no
    stage, so it is in no workload, queue depth or handling time.
- **Routes**: `GET/POST /agents`, `PATCH/DELETE /agents/:id`,
  `POST /agents/:id/run`, `GET /agents/:id/runs`, `GET /agent-notes`,
  `GET /agent-notes/:id`, `POST /agent-notes/:id/done`,
  `PUT /agent-settings` (the time zone, `Admin.Configure`; every started
  agent's next run moves with it).

### vf-licence, shared, vf-admin

- **Migration `0264`**: `licences.agent_limit` (NULL: vf-app's default).
  The licences route takes `agentLimit`; the token carries it only where
  set, so tokens for older licences are unchanged. `LicenceClaims`
  gains an optional `agentLimit`, checked when a token is verified.
- **vf-admin**: the licence editor has **Agents (blank: default)**, and
  the environment's licence line says how many.
- **Migration `0265`**: 145 strings, English and German.

### vf-ui

- **Agents** in the menu under Accounts payable, after Create, with an
  alarm-clock icon and a fixed colour (the first), so every other item
  keeps its own, as Create did (0573). Offered for `AP.Agents`, and for
  `Admin.UserManagement` so an administrator can remove anyone's, but
  never an administrator's first screen unless they make agents.
- **The Agents screen** (`agents.js`): the licence's count and the time
  zone (changeable with `Admin.Configure`); each agent's name and
  report, organisations, schedule in words, Started or Paused (with
  why), last run and when, next run in the environment's zone; Start,
  Pause, Run now, Edit, Runs (expanding), Remove (asked in place).
  **New agent**: name, a report offered only where the person holds
  its permission somewhere, organisations limited to those, and when.
  Administrators get **Everyone's agents**.
- **From agents** on the Tasks screen (`agent-notes.js`): each note,
  when and how many rows; **Open** shows its table in place, money to
  two decimals, organisations left out named; **Done** takes it off.
  Hidden when there is none.

## Not built (later slices)

- Email to the author or AP Managers, per-recipient filtering and
  language, CSV, opt-out, the copy in R2 kept 13 months (slice 2). Runs
  and notes stay in D1 until then; nothing deletes them yet.
- Ageing buckets, due soon and not yet eligible, stuck work, thresholds
  and comparison with the last run (slice 3).
- Plain words and plan versions (slice 4); the AI summary (slice 5);
  the agent's own page with each run's steps (slice 6).

## Verification

- **`vf-app`** `agent-schedule.test.ts`, 7 tests: a weekly time kept in
  London across the end of summer time and in Berlin; strictly after;
  working days; a date, the last day and last working day; once; the
  refusals; time zones. `agents.test.ts`, 17 tests: made paused; the
  refusals, an organisation the author cannot see named; the licence's
  count, the default and the licence's own, a removed agent freeing its
  place; reports offered only where held; started, run once when due
  and not twice, delivered to the author alone; outstanding payables
  (not eligible, delivered to the ERP and discarded left out; oldest
  first; days past due); a missed run once, late; nothing to report;
  an organisation left out, then paused on losing `AP.Agents`; once
  past refused, once finished; Run now; pausing always works; every
  report runs; notes their recipient's alone; author and administrator
  rights; a new time zone moving the next run; the routes' permissions.
- **`vf-ui`** browser `agents.test.ts`, 9 tests: in the menu for makers
  only (and administrators); each agent's row; the form offering only
  reports and organisations held, monthly on the last working day, the
  body sent and the saved message; the licence refusal in words;
  pause, Run now, remove asked first; an administrator's view of
  everyone's; From agents hidden when empty, a note's table in the
  reader's words with the unclaimed row and the organisation left out,
  Done; money and percentages. `tasks.test.ts`: a delegated
  administrator now also sees Agents. Worker: the ten new paths proxied.
- **`vf-licence`** `token-route.test.ts`, 1 new: the limit in the token
  only where set, refused unless a whole number 0 or more, and gone when
  set back to none. `operator-views.test.ts`: the limit shown.
- **Full runs**: vf-app 3510, of which 3508 pass (the two known
  failures); vf-ui browser 1511, of which 1510 pass (the known
  `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  worker 111 of 111; vf-licence 359 of 359; vf-admin 14 of 14; shared
  436, of which 432 pass and 1 is skipped (the three known failures).
  **Migrations** replay: vf-app 127, vf-licence 265.
