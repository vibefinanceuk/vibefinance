# 0625: Agents, slice 4: plain words, the plan shown in words, and plan versions

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0130`** and **vf-licence migration `0268`** (strings). Deploy vf-licence,
then vf-app and vf-ui. It uses the existing `AI` binding; nothing new to
configure.

## What was asked

Slice 4 of the six agreed with Dan on 4 October 2026
(`claude/agents-design.md`), after slice 3 (0624) went live (*"deployed
and pushed"*; *"yes - please proceed"*). It carries out the design's
"describe it in your own words" step, and Dan's answer to keep the form
as **Edit steps** beside it.

## What was built

### vf-app

- **`POST /agents/understand`** (`AP.Agents`; 503 `ai_unavailable`
  without the AI binding), `agent-understand.ts`. The request is at most
  600 characters. The model (`gpt-oss-120b` through
  `createWorkersAiCompilerModel`, as the rule compiler uses) is given a
  closed vocabulary: the reports the person may use, the organisations
  they can see for them, the AP Managers they may send to, the schedules
  and options there are, today and the organisation's time zone. It
  answers JSON; **our code checks every part of it**, and the model
  never saves anything. The answer is a draft for the form:
  `{ draft, refusals, missing, text }`.
- **Names to ids** by `matchName`: exact, then first name, then a part,
  and only when exactly one fits (accents ignored). *All* organisations
  means every one the report can be seen for.
- **Refusals**, each with the words they came from: `outside_address`
  and `cannot_act` (pay, approve, release, reject, delete, in English or
  German) are found by
  our own code whatever the model says; also `too_often`,
  `unknown_report`, `unknown_org`, `unknown_person`,
  `option_out_of_range` (the default kept) and `other`. Codes the model
  invents are dropped.
- **Missing**: `report`, `orgs`, `schedule`, when the words did not say
  them, so the screen can ask.
- **Migration `0130`**: `agents.description` (the words, kept),
  `agents.plan_version`, `agent_runs.plan_version`, and
  `agent_plan_versions` (each plan as JSON, who and when), backfilled
  with version 1 for every agent; an `ASSERT ALWAYS` that every agent's
  version is kept. Creating and editing keep a **new version only when
  the plan changes** (report, organisations, schedule, options, delivery,
  recipients); renaming, starting and stopping do not. Each run records
  the version it ran.

### vf-ui

- **Describe it**: a box at the top of a new or edited agent, and
  **Understand**. The draft fills the form; **the plan** is said in
  words, step by step (*When*, *Report*, *Narrowed*, *Delivered*), what
  was left out is listed with why, and anything missing is said in its
  step.
- **Edit steps**: the form, folded under the plan; open when something
  is missing or nothing was described, closed otherwise. Saving sends the
  description.
- If the AI cannot be reached, the screen says so and the form works by
  hand.
- The runs list says the plan version each ran.

## Not built (later slices)

The AI summary (5); the agent's own page and run history (6), where the
plan versions will be shown side by side.

## Verification

- **`vf-app`** `agents-understand.test.ts`, 7 tests, with a stand-in
  model: a sentence to a checked draft with names matched; the closed
  lists, today and zone in the prompt, people who are not AP Managers
  left out; an outside address and *pay* refused whatever the model said;
  *all* organisations; unknown report, organisation and people named;
  missing steps; an option out of range kept at its default; not
  understood, empty, too long, AI unavailable; name matching; a new plan
  version only when the plan changes, and the version a run records.
- **`vf-ui`** browser `agents.test.ts`, 3 new: the plan said in words,
  what was left out, Edit steps closed and the description saved; a
  missing schedule said and Edit steps opened; the AI unavailable said.
- **`vf-licence`** 359 of 359.
- **Full runs**: vf-app 3536, of which 3534 pass (the two known failures); vf-ui browser 1521, of which 1520
  pass (the known `typography.test.ts` 10px gap), with the same 331
  unhandled errors; worker 111 of 111; vf-licence 359 of 359.
  **Migrations** replay: vf-app 130, vf-licence 268.
