# 0501 — The Documents list learns `returned_manually` and `archived`

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

A bug, reported live after using decision 0498 for the first time:

> I placed the Return to Supplier button, but it continues to sit in
> the same queue it seems. Although gone from my task list, the item
> when searching for Documents, appears to still be in the matching
> Matching stage.

## What was found

Checked directly, not assumed: `handleReturnToSupplier` in
`return-route.ts` does exactly what it should — it ends the task,
cancels any siblings, and sets `process_instances.status =
'returned_manually'`. The task disappearing from the task list is
correct. `current_stage_id` is deliberately left untouched, per
decision 0055's own design: the stage a document was returned from is
a real historical fact, not something a terminal transition should
erase — the design puts the terminal answer at instance-status level,
never at the stage.

The bug is one layer up. `documents-route.ts`'s own `statusOf()` —
the function that turns `process_instances.status`, a stage, and
whether anything could be read into the single word a person sees —
predates decision 0055's two terminal statuses by many decisions
(0164 vs. 0055/0498) and was never taught about either of them:

```
function statusOf(row, facts) {
  if (facts["intake.structure"] === "") return "unreadable";
  if (row.instance_status === "completed") return "done";
  if (row.current_stage_id === null) return "outside";
  return row.hands > 0 ? "waiting" : "moving";
}
```

A `returned_manually` instance falls straight through every check to
the last line — `current_stage_id` is still `"validation"` (or
wherever it was), so it reads exactly as "waiting" or "moving" through
that stage, precisely the false impression reported. The Documents
screen's own `.stage-cell` unconditionally shows `stageName` whenever
it is non-null, with no status check at all, compounding it.

**Genuinely untested before this**: no test in `documents.test.ts`
covered `"waiting"`, `"moving"`, or `"done"` at all, let alone the two
newer statuses — this whole function was exercised only by the
`"outside"` and `"unreadable"` cases.

## What was decided

Add the two missing cases to `statusOf()` directly, ahead of the
`current_stage_id === null` check (both are terminal and take priority
over "what stage is this at" the same way `"completed"` already does).
`current_stage_id`/`stageName` are left exactly as they are — decision
0055's own reasoning for keeping that fact stands, and a completed
instance's own final stage (`"done"`) is legitimate to keep showing
unqualified, so the fix is scoped to only the two statuses that
actually leave an instance parked at a stage it no longer belongs to.
No new UI decision about hiding or relabelling the stage cell itself —
the status column, now honest, does the job of saying what actually
happened; the stage name next to it reads as history rather than as a
claim about the present.

## What was built

- **`workers/vf-app/src/documents-route.ts`**: `statusOf()` gained
  `returned_manually` → `"returned"` and `archived` → `"archived"`,
  both checked ahead of the stage-based fallback.
- **`workers/vf-ui/public/app.css`**: `.status.returned` (the same
  accent colour Reassign/Return To Supplier's own action icons use —
  a real action was just taken) and `.status.archived` (quieter than
  even `moving`/`outside`, matching the "closed, not merely idle"
  `--text-muted` a disabled `<select>` already uses).
- **`workers/vf-licence/migrations/0177_docstatus_returned_archived.sql`**:
  `docstatus.returned`/`docstatus.archived`, en/de.
- **Tests**: `workers/vf-app/test/documents.test.ts` — three new
  tests: a returned instance reads `"returned"` and still names its
  stage; an archived instance reads `"archived"`; a genuinely completed
  instance still reads `"done"` (checked directly, not assumed, since
  this fix sits one line above that check). `workers/vf-ui/test-browser
  /documents.test.ts` — two new tests confirming the row shows
  "Returned to supplier"/"Archived" rather than "Waiting"/"In
  progress", and that the stage name still renders alongside it.
  `workers/vf-licence/test/string-coverage.test.ts` — two new keys.

## What was not built

No change to `return-route.ts` or the underlying data — the bug was
never in how the terminal transition was recorded, only in how it was
read back for this one list. No change to the dashboard's "Where
things are" card or any other `status = 'in_progress'`-scoped view —
those already exclude terminal instances by construction (their own
`WHERE` clause), so they were never exhibiting this symptom. No change
to the stage cell's own display beyond what `statusOf()` already drove
via its shared status value.

## Verification

- `workers/vf-app`: `documents.test.ts` **69/69** (66 carried forward,
  3 new). Full suite, batched, **2965/2967** — the two failures are
  the same confirmed pre-existing, unrelated `capture-pdf.test.ts` and
  `stage-permissions.test.ts` gaps this session has verified via
  `git stash` before. `npx eslint`/`npx tsc --noEmit` clean on every
  touched file (the one `cloudflare:test` typecheck gap is a
  repo-wide, pre-existing condition unrelated to this change).
- `workers/vf-licence`: `string-coverage.test.ts` **10/10**. Full
  suite **320/320**, unchanged.
- `workers/vf-ui`: `documents.test.ts` (browser) **36/36** (34 carried
  forward, 2 new). Full browser suite **1174/1175** — the one failure
  remains the pre-existing, unrelated `typography.test.ts` gap. Plain
  suite **75/75**, unchanged.

## Still to do, operator side

Push, then redeploy **`vf-app`** (the `statusOf()` fix) and **`vf-ui`**
(the new status colours), and apply migration `0177` to `vf-licence`:
```
wrangler d1 execute vf-licence-poc --remote --file=workers/vf-licence/migrations/0177_docstatus_returned_archived.sql
```
(database name illustrative — use this deployment's own). Then reload
Documents and search for the invoice that was returned — its Status
column should now read "Returned to supplier" rather than "Waiting" or
"In progress," with "Validation" (or wherever it was) still shown
beside it as the stage it was returned from.
