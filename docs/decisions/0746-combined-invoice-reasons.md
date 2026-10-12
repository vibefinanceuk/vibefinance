# 0746: One task for every reason an invoice-level stage raises

**Status: live.** vf-app (`workflow-engine.ts`, `stage-actions-route.ts`,
`invoice-facts-route.ts`, `task-list-route.ts`), vf-ui (`viewer.js`, `tasks.js`), vf-licence
(strings migration 0345).

## What was asked

Dan, 12 October 2026: *"Obviously when a new invoice is created, before it is keyed all field
validations will fail. I'm not sure raising two tasks at that time is appropriate. Is there a
way to consolidate into one task for the user - in a similar we we have done in the matching
queue."*

## What changed

- **At a stage evaluated once per invoice** (Validation, and any stage not per line), the
  rules that fire are **grouped by who the task is for**: the same team, the same person and
  the same permission make **one task**. Different teams or permissions still get their own.
- **Always on.** Unlike per-line stages (0709), where Processes chooses one task per line or
  one combined, there is no setting: two tasks for one person on one invoice at one stage only
  ever meant claiming and completing the same work twice.
- The task carries every rule it stands for in `tasks.lines_json` (`[{line: null, rule}]`), its
  first in `rule_id`. **Complete re-checks every one** (`taskLines`, `checkTaskRule`): it is
  refused naming the first that still fails, and clears once none do.
- **The invoice's banner** names the first rule and then each other one, "·"-separated.
  **Tasks** shows "· 2 reasons" beside the invoice number.
- Tasks already open keep their shape; only those raised from now on combine.

## Tests

vf-app `combined-invoice-reasons.test.ts`: two rules for AP Team make one task naming both,
a third for Finance its own; Complete refused naming *No number*, then *No supplier*, then
allowed; My tasks counts 2 reasons; the banner names both. Existing workflow-engine,
stage-actions, combined-line-tasks, task-list, validation, upload and source-capture tests
unchanged and passing. vf-ui `viewer.test.ts` (the other reasons named) and `tasks.test.ts`
("· 2 reasons"). vf-licence string coverage.

## To deploy

Migration: vf-licence `0345_combined_reasons_strings.sql`. Deploy vf-app, vf-licence and vf-ui.
