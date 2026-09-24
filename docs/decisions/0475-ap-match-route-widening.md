# 0475 — AP.Match's own route-widening

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

*"Please take a look at 2 next and 'AP.Match's own route-widening'"* —
the second item of the backlog named repeatedly since decision 0468
(*"the real AP Setup Matching tab UI, 'Add person to conversation''s
own route/UI, standard-rule checkboxes, `AP.Match`'s own
route-widening"*) and reconfirmed untouched by every decision since,
most recently 0474.

## What was found

**`AP.Match` was in the exact same state `AP.Code` was in before
decisions 0455/0456**: real in the closed permission vocabulary
(`permissions.ts`), written into `assign_task { required_permission:
"AP.Match" }` by every one of decision 0474's own four
`STANDARD_MATCHING_RULES`, but checked by zero routes in `index.ts`.
`permissions.ts`'s own comment already named this directly: *"no route
yet accepts `AP.Match` the way those routes accept `AP.Code`; that
route-widening is its own later phase, per decision 0466's own note
that it should get the same treatment."*

**Traced the task flow rather than assumed the fix was identical to
0456's.** A matching rule fires `assign_task`, a task is created, and
`task-route.ts`'s own claim/complete logic checks the task's own
dynamic `required_permission` — that already worked for `AP.Match`
with no change needed, the same as it does for every other permission.
The gap is everything *after* claiming: the same five routes decision
0456 already found and fixed for `AP.Code` —

- `GET /invoices/:id` (`AP.Validate` or `AP.Code`, decision 0456;
  widened again for collaborators, decision 0470) — no `AP.Match`.
- `POST /invoices/:id/document-url` — same three, no `AP.Match`.
- `GET /invoices/:id/pages` — same, no `AP.Match`.
- `POST /invoices/:id/pages/:n/document-url` — same, no `AP.Match`.
- `GET /invoices/:id/progress` (`AP.Review` or `AP.Code`) — no
  `AP.Match`.

An `AP.Match`-only holder could claim a matching task and then find
every next step forbidden — open the invoice, see its document, see
where it's been — the identical shape decision 0456's own title
states plainly for `AP.Code`.

**Two routes decision 0456 widened were checked directly and found
deliberately out of scope here, not silently skipped:**

- **`POST /invoices/:id/key`** — decision 0456's own reasoning was
  that this is the Coding pop-out's own Save button. Decision 0467
  already investigated what resolving a matching exception actually
  involves — *"Proceed with payment regardless... is ordinary task
  completion, exactly as it already works... nothing checks the
  matching facts at completion time today, and nothing needs to for
  this to work"*; the other two named resolutions map onto a PO reload
  (nothing to build) and `AP.ReturnToSupplier` (already real,
  separately enforced). None of the three writes keyed facts through
  this route. Widening it for `AP.Match` would open a write path
  nothing in this feature calls.
- **`GET /org/cost-centres` / `GET /coding-lists/:type`** — these back
  the Coding pop-out's own search fields (Cost Centre, Project,
  Commodity Code, GL Code). Matching reads PO line data
  (`po.line_price_matched` and siblings, computed automatically by
  `po-matching.ts`), never these lists. No route on the Matching path
  calls them.
- **`GET /tasks`** — checked directly against decision 0471's own
  precedent (`Procurement.Approve` widened here specifically because a
  Business Approver is deliberately *not* AP staff and would otherwise
  never hold `AP.TaskView`). `AP.Match` sits in the same `AP.*`
  namespace as `AP.Code`, which was never added here either — the
  operational assumption both share is that a role granting task-
  bearing AP work grants `AP.TaskView` alongside it, the same as it
  already does for Coding. Not touched, matching that precedent rather
  than repeating `Procurement.Approve`'s different one.
- **`/documents/:id/activity`, `/documents/:id/comments`** — confirmed
  `AP.Review`-or-collaborator-only today, and `AP.Code` was never added
  to either one (decision 0456's own "what was not built" leaves them
  named but untouched). Left alone for `AP.Match` too, for the same
  reason: out of scope for this decision, not a gap unique to Matching.

## What was built

Five permission checks widened, each the same shape decision 0456
already established: an existing `hasPermission(...)` check gains
`AP.Match` alongside what it already accepted. Nothing removed.

- `GET /invoices/:id` — `AP.Validate` / `AP.Code` / collaborator →
  adds `AP.Match`
- `POST /invoices/:id/document-url` — same
- `GET /invoices/:id/pages` — same
- `POST /invoices/:id/pages/:n/document-url` — same
- `GET /invoices/:id/progress` — `AP.Review` / `AP.Code` / collaborator
  → adds `AP.Match`

`permissions.ts`'s own comment block and `AP.Match`'s
`PERMISSION_DESCRIPTIONS` entry updated to describe what's actually
enforced now, replacing the "reserved; no route accepts it yet"
wording that was correct before this decision and stale after it.

**No `vf-ui` change.** Permission checks are entirely server-side; the
frontend never gates on a specific permission string client-side, it
reacts to the response. Confirmed by grep — `AP.Match` and `AP.Code`
appear nowhere in `workers/vf-ui`.

## What was not built

- `POST /invoices/:id/key`, `/org/cost-centres`, `/coding-lists/:type`,
  `GET /tasks`, `/documents/:id/activity`, `/documents/:id/comments` —
  all checked directly and found out of scope, with reasoning above,
  not left untouched by oversight.
- No UI change surfacing which invoices an `AP.Match`-only holder can
  now reach beyond what already renders once the API stops refusing
  them — the Invoice Viewer, document pane, and progress panel are all
  existing screens with no permission-specific branching to add.

## Tests

`workers/vf-app/test/index.test.ts` — new describe block ("Viewing and
working an invoice while holding only AP.Match — decision 0475"), the
same nine-test shape decision 0456's own block uses: each of the five
widened routes proven to now accept `AP.Match` alone, two regression
checks (`GET /invoices/:id` and `GET /invoices/:id/progress` still
refuse a user holding neither permission), and one explicit negative
test confirming `POST /invoices/:id/key` still refuses `AP.Match`
alone — proving the scoping decision above rather than leaving it
implicit. **173/173** for the whole file (9 new). Run together with
`test/invoice-facts-route.test.ts`, `test/task-route.test.ts`, `test/
session-routes.test.ts`, `test/coding-list-route.test.ts`, `test/
cost-centre-route.test.ts`, `test/field-visibility.test.ts`, `test/
stage-permissions.test.ts`, `test/matching-config-route.test.ts`, and
`test/rules-list.test.ts` — **372/372**, zero regressions. `test/
scoped-roles.test.ts` (the closest thing to a permission-vocabulary
audit test) — **48/48**, confirming the `PERMISSION_DESCRIPTIONS`
wording change broke nothing.

`tsc --noEmit` and `eslint` both confirmed clean on every touched file
(the only `tsc` noise present is the same pre-existing cross-package
`cloudflare:test` module-resolution class already documented in
decision 0474, untouched by this decision's own files).

## Still to do, operator side

Nothing to apply — `vf-app` only, no schema change, no migration, no
`vf-ui`/`vf-licence` change. Once pushed and deployed, an `AP.Match`-
only role can claim a standard-matching-rule task (decision 0474) and
actually open the invoice it was raised against, immediately.
