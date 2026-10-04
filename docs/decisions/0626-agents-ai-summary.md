# 0626: Agents, slice 5: the AI summary, numbers checked, and a daily count on the licence

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui`, `vf-licence`, `vf-admin` and `shared`. It
needs **vf-app migration `0131`** and **vf-licence migrations `0269`**
(the licence's summary limit) **and `0270`** (strings). Deploy
vf-licence, then vf-app, vf-ui and vf-admin. It uses the existing `AI`
binding.

## What was asked

Slice 5 of the six agreed with Dan on 4 October 2026
(`claude/agents-design.md`), after slice 4 (0625) went live (*"looks good
- deployed, and pushed - migrations applied"*; *"lets move onto the next
slice"*). It carries out the design's decision 4 (*AI summary: on by
default; numbers checked against the table, dropped on any mismatch*),
decision 11 (each recipient's own language, the summary included) and
its guardrail of a daily AI budget per environment. Asked how that
budget should work, Dan chose **a daily count of summaries on the
licence**, like the agent limit, default 100.

## What was built

### vf-app

- **`agent-summary.ts`.** For each copy of a report, the model
  (`gpt-oss-120b`, as the compiler uses) is given that copy's table as
  its reader sees it (at most 40 rows, numbers already written out in
  their language, highlighted rows marked, totals and the comparison with
  the last report) and asked for 2 to 4 sentences in English or German:
  no dates, no new arithmetic, nothing but the names given, no advice to
  pay or approve.
- **The check (`strayNumber`).** The table's own text (supplier and
  organisation names, invoice numbers) is set aside, then **every number
  left must be one of the table's**: a cell, a total, a count, the last
  report's totals and the change since, the row and highlighted counts,
  or an option, as written in the reader's language or rounded to a
  whole number. Anything else (a sum, a percentage, a year, a date) and
  the summary is dropped. Markdown is stripped; links, addresses and
  anything over 700 characters are refused.
- **Never a reason not to send.** A copy without a summary goes as
  before. Each delivery row records what happened (`summary`):
  `written`, `off`, `mismatch`, `over_budget`, `ai_unavailable`,
  `no_ai`.
- **One summary per distinct copy and language** within a run: two
  readers who see the same table in the same language share one.
- **The daily count.** `agent_ai_days` counts summaries per UTC day,
  taken in one conditional statement so two runs cannot both take the
  last; the limit is the licence's `summaryLimit`, default 100; 0 means
  none.
- **Migration `0131`**: `agents.summary` (on, by default, for every
  agent), `agent_deliveries.summary`, `agent_ai_days`.
- **The switch** is part of the plan: turning it off or on makes a new
  plan version. A plan kept before this slice (summary on) is unchanged,
  as the plan only says `summary: false` when off.
- **Where it shows**: on top of the email (text and HTML, marked
  *Summary, written by AI from the table below* in the reader's
  language) and on the note in Tasks (`report_json.summary`).
- **Plain words** understand *no summary*; the draft carries `summary`.
- `GET /agents` adds `summary` per agent, `aiReady` and
  `summaries: {used, max}` for today; runs list each delivery's
  `summary`.

### vf-licence, shared and vf-admin

- **Migration `0269`**: `licences.summary_limit` (NULL for the default).
  `POST /licences` takes `summaryLimit` (a whole number, 0 or more, or
  null); the signed token carries it only where set; the shared claims
  check accepts it; the operator views return it.
- **vf-admin** licence editor: *AI summaries a day (blank: default)*,
  and the licence line says it.

### vf-ui

- **Edit steps** has *AI summary: Write a few sentences on top of each
  report*, ticked for a new agent, with what it does or, where AI is not
  bound, that reports go without.
- **The plan** has a *Summary* step.
- **The list** says *AI summary* in an agent's delivery line, and the
  heading says *AI summaries today: N of M*.
- **Runs** say what became of the summaries, once per kind (*summary
  written*, *no summary: a number did not match the table*, and so on).
- **A note** shows the summary above its table, marked as the AI's.
- Help lines 21 to 23.

## Not built (slice 6 and later)

The agent's own page with run history and plan versions side by side;
failures as a task to the author; the admin log. Recording what each
summary cost in tokens waits for the model wrapper to report usage.

## Verification

- **`vf-app`** `agents-summary.test.ts`, 9 tests, with a stand-in model:
  numbers read in each language; cells, totals, counts, the change,
  rounding allowed; a sum, a percentage, a year and a date caught; each
  reader's own copy in their language, Maya's prompt without the
  organisation she cannot see; the summary in the email (text and HTML)
  and on the note; the same copy written once and counted once; a stray
  number dropped and the report still sent; AI down, no AI, the day's
  count used, each said; the count one at a time, a new day, a limit of
  0; turned off with no model call, and on again as a new plan version.
  `agents-email.test.ts` and `agents-understand.test.ts` updated.
- **`vf-licence`** 360 of 360, with a new token test for
  `summaryLimit`.
- **`vf-ui`** browser `agents.test.ts`, 4 new: on by default, the plan
  step, turned off and sent, today's count; AI not set up said; run
  words once per kind; the summary on a note.
- **Full runs**: vf-app 3545, of which 3543 pass (the two known failures); vf-ui browser 1525, of which 1524
  pass (the known `typography.test.ts` 10px gap), with the same 331
  unhandled errors; worker 111 of 111; vf-admin 14 of 14; shared 436, of
  which 432 pass and 1 is skipped (the same three known failures, checked
  with and without this change). **Migrations** replay: vf-app 131,
  vf-licence 270.
