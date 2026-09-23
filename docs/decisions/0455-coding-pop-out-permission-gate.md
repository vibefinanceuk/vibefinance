# 0455 — The Coding Pop-out's Search Routes Now Also Accept AP.Code

**Status: built and tested, not yet pushed.** This session has no push
access — delivered as a bundle (`origin/main..main`) for the operator
to apply and push. Built on top of `bef7414` (decision 0454's own
confirmation commit); this session's own tip commit is `6e4f615`.

---

## What was asked

A live report, immediately after decision 0454 unstranded the Coding
stage and the operator seeded its first real rule (this session,
requiring `AP.Code`): a person holding a claimed Coding task could see
the invoice-line Coding pop-out (decision 0453), but its four
fields — Cost Centre, Project, Commodity Code, General Ledger
Code — all showed read-only with "not editable" rather than the
searchable pickers decision 0453 built. Traced first to a genuine,
separate configuration gap (none of those four fields had ever been
granted `edit` visibility anywhere — fixed directly against the live
database, not by this decision) and then, once that was fixed and the
pickers rendered, to this: the lookup endpoints those pickers call
were still gated on a permission a `AP.Code`-only holder does not
necessarily have.

## What was found

`GET /org/cost-centres` and `GET /coding-lists/:type` — the two routes
`fetchCodingEntries` (viewer.js) calls for all four Coding pop-out
fields — are gated `Admin.Configure OR AP.Validate` (decision 0453).
That was a correct read of the product at the time: Coding's own rule
set was empty (the exact gap decision 0454 fixed), so no `AP.Code`-only
task had ever existed, and "the person keying a line holds
`AP.Validate`" — true of every real keyer up to that point, since
`POST /invoices/:id/key` itself already requires it — was a reasonable
generalization from the evidence available.

It stopped being true the moment Coding got a real rule. The rule
seeded this session requires `AP.Code` specifically (matching the
operator's own choice: `AP.Code` permission, AP Coding team), and
nothing requires a member of that team to also hold `AP.Validate`. A
person who can see the Coding queue, claim a task, and open the
pop-out could still get a 403 trying to search any of its four fields
— visible and claimable, but not actually usable, for exactly the
population the pop-out exists to serve.

## What was built

Both routes' permission check widened from two permissions to three:
`Admin.Configure`, `AP.Validate`, `AP.Code` — same shape as decision
0453's own widening, applied once more rather than forked. Two call
sites in `index.ts`, both `GET` handlers only:

- `GET /org/cost-centres`
- `GET /coding-lists/:type`

Neither route's write sibling (`POST /org/cost-centres`, `POST
/coding-lists/:type`) changed — both stay `Admin.Configure`-only, since
searching a list to key a value and configuring what the list
contains are still two different things decision 0453 already drew
that line around.

## What was not built

- **No change to which fields render editable.** That gap (all four
  Coding fields lacking a `field_visibility` row entirely) was real
  but separate, and was corrected directly against the live database
  during this conversation rather than through a code change — nothing
  in the schema or route logic was wrong there, only the seeded
  configuration.
- **No change to `AP.Validate`'s own access.** Widened, not narrowed —
  anyone who could reach these routes before still can.

## Verification

`workers/vf-app`: `test/index.test.ts` — two new tests (`GET
/org/cost-centres now also works for AP.Code alone`, `GET
/coding-lists/:type now also works for AP.Code alone`) plus one
confirming the write side is untouched (`POST /coding-lists/:type
still refuses AP.Code alone`), alongside the six existing tests in the
same describe block (renamed to name decisions 0453/0455 together) —
**13/13** in that block. Run together with the rest of `test/
index.test.ts` in full, plus `test/coding-list-route.test.ts`, `test/
cost-centre-route.test.ts`, `test/stage-permissions.test.ts`, and
`test/field-visibility.test.ts` (every file that plausibly touches
what changed) — **226/226**, zero regressions. `npx tsc --noEmit`
surfaces no new errors in `index.ts` or `test/index.test.ts`; the
errors it does report are the same pre-existing, unrelated ones
(`test/workload.test.ts`'s own type-cast warnings, and cross-project
`cloudflare:test` resolution in `vf-licence`/`vf-ui` when type-checked
from this workspace) decision 0454's own verification already named.

No `vf-ui` or `vf-licence` change — this decision touches only
`vf-app`.

## Still to do, operator side

Push and deploy `vf-app` once this is bundled and delivered — same as
every other decision this session. Worth checking whether Michael
Finch (or anyone else on the AP Coding team) holds `AP.Validate` in
addition to `AP.Code` today; if not, this is the fix that unblocks
them, and no further permission grant is needed on their account.
