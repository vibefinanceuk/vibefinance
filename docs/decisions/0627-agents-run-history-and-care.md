# 0627: Agents, slice 6: the agent's own page, the agent log, and failures as a task

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0132`** and **vf-licence migration `0271`** (strings). Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

Slice 6, the last of the six agreed with Dan on 4 October 2026
(`claude/agents-design.md`), after slice 5 (0626) went live (*"deployed
and pushed"*, *"migrations applied"*). Asked the open choices, Dan chose:

- **Failures**: a task for the author.
- **The agent's page**: run steps (as the design's mock-up 3), plan
  versions, and who gets it and who stopped.
- **The admin log**: changes only.

There was no environment-level admin log to add to (the operator
console's is for operators' own actions), so the agent log is new: on
each agent's page, and, for administrators, of every agent on the Agents
screen.

## What was built

### vf-app

- **Migration `0132`**: `agent_events` (agent, when, who or NULL for
  VibeFinance, kind, detail) and `agent_notes.kind` (`report` or
  `failure`). Backfilled with what was known: each agent's making, each
  removal, and each recipient who stopped it.
- **The agent log** records `created` (with the version), `changed`
  (a new plan version, from and to), `renamed` (from and to),
  `started`, `paused`, `paused_access` (by VibeFinance, when the author
  lost access), `removed` (and whose agent, where an administrator
  removed someone else's), and `stopped_receiving` (once, however often
  the link is followed). Runs are not in it.
- **A failure is a task for its author.** After a scheduled run that
  failed, or delivered with some copies failing, the author gets one
  `failure` note: what went wrong, whether it was some copies or the run,
  how many times and since when. While the agent keeps failing, the same
  note is brought up to date. A run that succeeds, Run now included,
  marks it done; a failing Run now adds nothing, as the screen already
  says. Recipients cannot "stop" a failure note.
- **`GET /agents/:id`**, for its author or an administrator: the agent,
  every plan version newest first (with the names of the organisations
  and people it named), who gets it with when they were added and when
  they stopped, and its log. A removed agent's page stays readable.
- **`GET /agent-events`**, for administrators: the latest 200 changes to
  every agent.

### vf-ui

- **An agent's name opens its page**: the runs, the latest opened, each
  step by step (late, gathered and totals, nothing to report, the
  summary, each copy sent or failed and why); every plan version, the
  current one marked, the words it was described in, the plan in words,
  and what changed from the one before; who gets it, its author, and who
  stopped when; and what was changed, by whom. **All agents** goes back,
  and Edit opens the form.
- **The agent log** on the Agents screen for administrators: shown on
  request, each change in words, the agent's name opening its page.
- **A failing agent on Tasks**: marked *Failing*, why, how many times
  since when, **Open the agent** and Done.
- `/agent-events` through the proxy; help lines 24 to 26.

## The six slices, done

Engine (0622), email (0623), shape and reports (0624), plain words
(0625), AI summary (0626), run history and care (0627). Phase 2 next
when Dan chooses it: event triggers, an examples library, AR agents and
links into Documents at a report's filter.

## Verification

- **`vf-app`** `agents-care.test.ts`, 4 tests: each change logged with
  who, in order, through to an administrator's removal; a recipient
  stopping twice logged once; plan versions with names and recipients
  with stop dates on the page; the page for its author or an
  administrator, the log for administrators only; VibeFinance pausing
  for lost access, logged and told to the author; one failure note while
  failing (times, first and last), a failing Run now adding nothing, a
  succeeding one marking it done; some copies failing said as partial,
  and done by hand.
- **`vf-ui`** browser `agents.test.ts`, 3 new: the page from the name,
  runs step by step, choosing another run, versions with what changed and
  the words, who gets it, the log, back; the agent log for an
  administrator, VibeFinance named; a failing note on Tasks opening the
  agent's page. Worker test: the two new paths through the proxy.
- **Full runs**: vf-app 3549, of which 3547 pass (the two known failures); vf-ui browser 1528, of which 1527
  pass (the known `typography.test.ts` 10px gap), with the same 331
  unhandled errors; worker 111 of 111; vf-licence 360 of 360.
  **Migrations** replay: vf-app 132, vf-licence 271.
