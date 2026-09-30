# 0574: Opening an invoice from elsewhere brings its task's full row

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app` and `vf-ui`. There are no migrations.

## What was reported

0573 was deployed on 30 September. Dan uploaded a PDF on Create and
opened the invoice it made. The document showed, but:

- every field was locked;
- the Claim button was missing;

so nothing could be keyed by hand.

## Why

The viewer decides Claim, and whether any field can be keyed, from the
task as the task list gives it:

- who holds it (`ownership`);
- what it offers (`actions`).

Create's Open passed `openTaskById` only the task's id, its stage and the
invoice. With no `actions`, the viewer offered nothing. With no
`ownership`, it treated the task as someone else's and locked every
field.

The dashboard's worklist (0250) opens invoices the same way, so it had
the same fault.

## What was decided

- **`openTaskById` reads the task's full row** when it is given an id
  without actions. It asks the task list for that one task
  (`GET /tasks?task=<id>`) and opens the viewer with the row.
  - This mends Create's Open and the dashboard's worklist alike.
  - A task this person may not see there, or a failed request, opens as
    given, to look at.
- **The task list takes `task=<id>`** (`taskId` in `handleListMyTasks`).
  It is one more condition in the same shared `WHERE`, so it stays
  within everything the list already applies: the person's own and
  their teams' tasks, scoped by permission and unit. A task they may not
  see is simply not returned. Ownership and the page moved to `?10` to
  `?12`.

## Verification

| Where | Test | What it checks |
|---|---|---|
| `vf-app` | `task-list-route.test.ts`, 1 new test | One task by id, with `ownership: "mine"` and its actions, and a total of 1; nothing for someone who may not see it. It fails against the code before this change. The file and `dashboard.test.ts`: 141 of 141 |
| `vf-ui` | `create.test.ts`, 1 new test | An uploaded file's Open asks the task list for `task=t-1`, and the viewer opens with **Claim**. It fails with `openTaskById` as it was |

Full runs:

- `vf-app`: 143 files and 3337 tests, of which **3335 passed**. The two
  failures are the ones already known (0511).
- `vf-ui` browser: 1386 of 1387 pass. The one failure is the known
  `typography.test.ts` 10px gap.
