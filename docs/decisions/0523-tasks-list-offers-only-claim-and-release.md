# 0523 — The Tasks list offers only Claim and Release

**Status: pushed (`a818252`) and `vf-ui` deployed, as confirmed by the operator on 27 September.** It
changes `vf-ui` only, with no migration and no string change.

## What was asked

> The task list should only show Claim and Release tasks. I'd like for
> other actions to be only actioned from within the document viewer
> itself. This keeps the task list clean

## What was decided

**`taskRow` (in `tasks.js`) shows only `claim` and `release`.** These
are the two actions that are about the queue: taking a task, and giving
it back. Every other action acts on the document, so it now happens
where the document can be seen: Complete, Route To Approver, Return,
Return To Supplier, Discard and Reassign.

**Nothing on the server changed.** Each task still carries its full
`actions`, and the viewer still offers them exactly as before. Opening a
row still opens the document (0288).

A row with neither Claim nor Release shows a dash in the Action column.
That is the case for a task already claimed by someone else, or one
assigned directly to you (which cannot be released, 0489).

## What was verified

- **`tasks.test.ts`:**
  - A claimed task with Complete, Release, Reassign, Return and Route
    To Approver shows only Release.
  - An available task shows only Claim.
  - A task with no queue action shows a dash.

  Both new tests **failed** with `tasks.js` stashed. Two existing tests
  that clicked or expected Complete in the list now use Claim and
  Release instead.
- **Browser suite:** 1209/1210. The one failure is the known
  `typography.test.ts` `10px` gap.
- **`npx eslint`:** clean.
