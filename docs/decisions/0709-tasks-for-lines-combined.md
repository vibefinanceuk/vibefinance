# 0709: Tasks for lines: one per line, or combined by who handles them

**Status: live** at `a0ac478`, pushed and deployed 9 October 2026, migrations applied. vf-app (`workflow-engine.ts`, `stage-actions-route.ts`,
`approval-hierarchy.ts`, `task-list-route.ts`, `invoice-facts-route.ts`, `process-route.ts`,
`index.ts`, `i18n.ts`), migration `0157_combined_line_tasks.sql`; vf-ui (`processes.js`,
`tasks.js`, `viewer.js`, `app.css`); vf-licence migration `0318_line_tasks_strings.sql`.

## What was asked

Dan, 9 October 2026, after INV-16356 sat at Matching with a task for each of its lines:

> can you evaluate the effort to raise a single task for matching exceptions rather than a
> task per line item

On the evaluation: *"For PO matching the likelihood is that an operator will complete all
matching exceptions in one visit … Would this be a feature of the AP Setup configuration…
Or do you have another way to handle this configuration?"* Proposed: a setting on the
stage, beside the one that already says whether it is evaluated once per invoice or once
per line. A mock-up followed, and then: *"I can see when adding a stage - there is a once
per invoice, or once per line option. But that cannot be modified after creation"*. Both
agreed: *"Yes please - thank you"*.

## What it does

**Tasks for lines**, `process_stages.line_tasks`, on a stage evaluated once per line:

| Value | Tasks raised |
| --- | --- |
| `per_line` | One per line that needs attention, per rule and target: the behaviour until now |
| `combined` | One per team, person and permission, covering every line going to them |

"Combined by who handles them", not "one per invoice", because that is what keeps it right
at every stage: at Matching every line goes to the AP team, so it is one task per invoice;
at Approval each approver gets one task for their own lines, and different approvers still
get their own.

**Defaults** (migration 0157): combined for stages evaluated per line whose permission is
`AP.Match`, `AP.Code` or `AP.Approve`, that use the approval hierarchy, or whose id is
`matching`, `coding`, `account_coding` or `approval`. Every other stage stays per line.

**Storage.** A combined task covering one line is stored exactly as a per-line task. One
covering several keeps `line_number` NULL, takes the first line's rule as `rule_id`, and
lists every line with the rule that sent it in `tasks.lines_json`:
`[{"line":1,"rule":"r-po"},{"line":4,"rule":"r-po"}]`. A task for a split line's rows
(0551) is never combined: its rows belong to that line alone.

**Complete.** Where the stage re-checks the rule on Complete (0487), a combined task is
checked line by line, each against the rule version that raised it. It still fires while
any line does; Complete is refused naming them (*"… still holds on line 4"*), and the 409
carries `lines`. It has cleared only when every line has. The receipt re-check (0648) uses
the same answer, so a combined Awaiting receipt task closes only when all its lines are in.

**Who coded a line** (`findLineCoder`, for Employee-Supervisor approval): a combined coding
task counts for every line it lists.

**On screen.**

- **Processes**: on a draft, a stage's name opens its settings: name, Evaluated (once per
  invoice / once per line) and, when per line, Tasks for lines with a line of help for
  each. Add stage offers the same. `PUT /processes/:id/draft/stages/:stage`
  (Admin.Configure), through the proxy path already allowed for removing a draft stage.
- **Tasks list**: *"INV-16356 · lines 1, 2, 3, 4"* (`lineNumbers` on each task).
- **Invoice**: the "Here because" banner adds a chip naming the lines (`openTaskReason.lines`).

## Stage settings are not versioned

`process_stage_versions` holds only which stages a version has and their order. A stage's
name, evaluation scope and Tasks for lines live on `process_stages` itself, so an edit
applies to the next invoice to reach that stage, whether or not the draft is published.
The settings pop-out says so. Tasks already open keep the shape they were raised with.

## Not done here

- Opening the settings of a stage in the **live** version without a draft. The pop-out is
  offered on a draft's stages, where Processes already lets a person change things.
- Changing the rule set or permission from the same pop-out.
- Merging tasks already open when a stage is switched to combined.

## Tests

- vf-app `combined-line-tasks.test.ts` (14): per line and combined raising, a one-line group
  stored as before, a header stage never combined, `taskLines`/`linesOf`, the re-check
  across lines (fires, names the line still failing, clears), per-line unchanged, the
  Complete route's 409, `findLineCoder`, the Tasks list and the banner, the stage edit
  (values, refusals, another process), adding a draft stage combined, the PUT route.
- vf-ui: Processes (5: which names open settings, the pop-out's values and hiding, Save's
  body, no editing without Admin.Configure, Add stage's choice), Tasks list label, banner chip.
- vf-licence: the 8 new keys in string coverage.
