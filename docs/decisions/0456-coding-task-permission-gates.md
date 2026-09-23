# 0456 — AP.Code Can View and Work an Entire Coding Task, Not Just Search and Claim It

**Status: confirmed pushed and deployed.** `origin/main` fetched
directly reads `2b4c520` (this decision's own code is commit `dee4151`,
built on top of decision 0455's own tip commit, carried forward
through decision 0457's own commit on top), and the operator confirmed
`wrangler deploy` run for `vf-app` — the only worker this decision
touched. No migration to apply.

---

## What was asked

Not asked directly — found while wiring an unrelated new route
(decision 0457's own autocode suggestion endpoint) and checking, out
of habit after decision 0455, whether the routes it sits beside had
the same gap. They did, worse.

## What was found

Decision 0455 widened the Coding pop-out's own two search routes
(`GET /org/cost-centres`, `GET /coding-lists/:type`) to accept
`AP.Code`. That fixed searching. It did not fix the rest of the path a
real Coding-task holder actually walks:

- **`GET /invoices/:id`** — the route the viewer opens an invoice
  with — was `AP.Validate`-only.
- **`POST /invoices/:id/document-url`** and **`GET /invoices/:id/
  pages`** / **`POST /invoices/:id/pages/:n/document-url`** — seeing
  the underlying document at all, single-page or multi-page — were all
  `AP.Validate`-only.
- **`GET /invoices/:id/progress`** — was `AP.Review`-only, despite its
  own comment already stating the intent plainly: *"Anybody who may
  look at an invoice may see where it has been."* `AP.Code` was
  missing from that "anybody" the same way it was missing everywhere
  else.
- **`POST /invoices/:id/key`** — the route the pop-out's own Save
  button actually calls — was `AP.Validate`-only. Decision 0455 alone
  would have let an `AP.Code`-only person search the lists, choose
  values, and then hit a 403 the moment they tried to save — a worse
  failure than before decision 0455, since it now lands one step
  later, after real work.

**All six share one root cause.** Every one of them was written when
`AP.Validate` (or, for progress, `AP.Review`) was a reasonable stand-in
for "anyone who may legitimately be looking at this invoice," because
`AP.Code` had never been a task-bearing permission with its own real
holders. Decision 0454 fixed the stage-stall bug that let Coding
actually raise tasks; this session's own seeded rule made `AP.Code`
the permission those tasks require; decision 0455 caught the first,
most visible gap that exposed. This decision is the rest of it — an
`AP.Code`-only person could, before this, see the queue, claim a task,
and then find every single next step forbidden.

## What was built

Six permission checks widened, each the same shape: an existing
single-permission `hasPermission(...)` (or, for the two search routes,
decision 0453/0455's own `requireAnyPermission` list) gains `AP.Code`
alongside what it already accepted. Nothing removed — every permission
that could reach these routes before still can.

- `GET /invoices/:id` — `AP.Validate` → `AP.Validate` or `AP.Code`
- `POST /invoices/:id/document-url` — same
- `GET /invoices/:id/pages` — same
- `POST /invoices/:id/pages/:n/document-url` — same
- `GET /invoices/:id/progress` — `AP.Review` → `AP.Review` or `AP.Code`
- `POST /invoices/:id/key` — `AP.Validate` → `AP.Validate` or `AP.Code`

## What was not built

- **No audit of every other permission gate in `index.ts`.** Routes
  gated on `AP.Supplier`, `AP.Dashboard`, `AP.Analysis`,
  `AP.FraudReview`, `AP.Assistant`, and `AP.TaskView` were left alone —
  none of them are on the path a Coding task actually walks, and
  widening them without a reason would be scope creep past what this
  decision is for. `PUT /invoices/:id/org` and `PUT /invoices/:id/
  supplier` were also left alone deliberately: both are genuinely
  Validation-stage acts (decisions 0222/0434), not something Coding
  does.
- **No equivalent audit for `AP.Match`.** The same class of gap could
  exist for Matching's own permission; it wasn't reported and wasn't
  checked here. Worth a similar pass if it turns out to matter in
  practice.

## Verification

`workers/vf-app`: `test/index.test.ts` — a new describe block ("Viewing
and working an invoice while holding only AP.Code") with 9 tests: each
of the six widened routes proven to now accept `AP.Code` alone (either
a direct `200` where the response shape is predictable, or `not.toBe
(403)` where the underlying resource's own 404/500 is the honest
answer and 403 specifically is what's being disproven), plus two
regression checks (`GET /invoices/:id` and `GET /invoices/:id/
progress` both still correctly refuse a real user holding neither
permission). Run together with the rest of `test/index.test.ts`,
`test/invoice-facts-route.test.ts`, `test/task-route.test.ts`, `test/
session-routes.test.ts`, `test/coding-list-route.test.ts`, `test/
cost-centre-route.test.ts`, `test/field-visibility.test.ts`, and
`test/stage-permissions.test.ts` — **296/296**, zero regressions.
`npx tsc --noEmit` on `index.ts` itself: zero errors, both before and
after this change (confirmed via `git stash` comparison); the
repository's own much larger pre-existing error count elsewhere is
unrelated and unchanged.

No `vf-ui` or `vf-licence` change, no new migration.

## Still to do, operator side

Push and deploy `vf-app` once this is bundled and delivered. Worth
re-checking Michael Finch's own experience end to end once live —
open a claimed Coding task, view the document, search and save a
value — now that every step on that path should work with `AP.Code`
alone.
