# 0614: Open tasks by user, the ring opens Documents

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0257`** (strings). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 3 October 2026, after 0613: *"could we allow this graph to also be
clicked into, to launch the suitable values in the documents window?"*,
as the Throughput and Team queue depth bars do (0611).

## What was decided

On *Open tasks by user*, for the person chosen in the drop-down:

| Click | Opens Documents at | Banner |
|---|---|---|
| a **slice** of the ring, or its **row in the key** | the invoices with a task open for that person **at that stage** | *Showing what is open for Wei Chen at Approval* |
| **anywhere else on the ring** (its middle, the total) | the invoices with **any** task open for that person | *Showing what is open for Wei Chen* |

"Open for that person" is what the card counts: an open task they own
or have claimed. The key's rows also open from the keyboard (Enter or
Space), as does the ring.

- `GET /api/documents` gains **`openFor=<user id>`** and, with it,
  **`openStage=<stage id>`**; `openStage` alone is ignored. Another
  person's needs **AP.Analysis**, as `doneBy` does (0611).
- `donutChart` gains **`arcs: true`**, making the slices targets as well
  as the key. 0264 kept clicks to the key because a thin stroke is a
  poor target on a small ring; this card asks for the slices, and other
  rings are unchanged. Wherever a ring's key is clickable, its rows are
  now reachable from the keyboard too. The folded "…" rest is never a
  target, as before.

**The counts can differ**, as for 0611: the ring counts tasks and
Documents lists invoices, so someone with two open tasks on one invoice
shows 2 in the ring and one invoice in Documents.

## Verification

- **`vf-app`** `documents.test.ts`, 3 new tests: a person's open tasks,
  owned or claimed (an unclaimed team task, someone else's and a
  completed one left out); narrowed to a stage; a stage without a person
  ignored. `documents-analytics-filters.test.ts`: your own 200, another
  person's 403 without AP.Analysis and 200 with it. 3 fail against the
  route before this change. Full run 3455, of which 3453 pass (the two
  known failures).
- **`vf-ui`** browser `workload-open-tasks.test.ts`, 3 new tests: a slice
  asks for `openFor` and `openStage` and shows the banner; a key row by
  keyboard the same; the rest of the ring asks for `openFor` only, and
  is labelled for a screen reader. 3 fail against the interface before
  this change. `dashboard.test.ts` unchanged and passing. Full run 1467,
  of which 1466 pass (the known `typography.test.ts` 10px gap); worker
  111 of 111.
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 257.
