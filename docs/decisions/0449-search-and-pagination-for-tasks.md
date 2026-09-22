# 0449 — Real Search and Pagination for the Tasks Screen

**Status: built, tested, not yet confirmed by the operator.** Committed
and delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0448 already used.

---

## What was asked

The Tasks half of decision 0448's own request: *"We parked the Document
and Task search screen, which require a deeper level of build to
introduce search and pagination. Can you implement those changes
now?"* — deferred by decision 0446 for Tasks specifically, and by
decision 0448 a second time, because (per 0448's own "What was not
built") Tasks' visibility check walks unit lineage in the opposite
direction from every other screen decision 0446 could give the same
treatment to, and decision 0446 named that plainly: *"not expressible
as a SQL `WHERE` clause without a much larger change."* This decision
is that change.

The same org-focus requirement decision 0448 already satisfied for
Documents applies here unchanged: *"the search for Tasks and Documents,
needs to be within the boundaries of the Org that currently has
focus."* Confirmed with *"yes - move onto Tasks please"* once Documents
was confirmed deployed.

## What was found, not assumed

The old `maySee(task)` (`task-list-route.ts`) decided visibility by
walking **upward** from a task's own document unit, one query per
ancestor level (`unitLineage()`, `unit-config.ts`), and testing whether
any unit a held permission was scoped to appeared in that upward chain.
Every other screen this project has since given search-and-pagination
(Purchase Orders, Account Coding, Documents) instead walks **downward**
from each held unit once, via `unitsBeneath()` (`enforce.ts`), and
tests membership in that precomputed set — the shape a SQL `WHERE`
clause can express as `IN (SELECT value FROM json_each(?))`. These are
not two different rules; they are the same rule read in opposite
directions, and proving that equivalence is what actually unblocks this
decision, not any new capability in `unitsBeneath()` itself:

- A task with no document unit is always visible, under both. The old
  code's own first line said so directly (`if (!task.orgUnitId) return
  true;`); the new SQL says the identical thing (`h.org_unit_id IS
  NULL`).
- A permission held nowhere in particular (`heldIn.get(p) ===
  undefined`) or everywhere (`=== null`) imposes no restriction, under
  both — the old code folded these into one "no restriction" branch;
  the new SQL folds them the same way, by the permission simply not
  appearing in `scopedPermissions` at all.
- A permission held in specific units restricts visibility to tasks
  whose own unit is reachable from at least one of them, under both —
  "is some held unit an ancestor of the task's unit" (upward walk, Set
  membership) and "is the task's unit in the downward-reachable set
  from some held unit" (`unitsBeneath()`, membership) are the same
  claim, checked from opposite ends. `unitsBeneath()` already existed
  and already computed exactly this set for one starting unit; nothing
  about it needed to change, only where it got called from.

The second piece this decision needed and the others did not:
`ownershipOf()`'s three-way split (`mine`/`locked`/`available`) had
always been JS, computed per row after everything else loaded — because
until now nothing needed real SQL-level pagination *under* an ownership
filter. It is fully expressible as one SQL `CASE`, which is what
finally makes `LIMIT`/`OFFSET` real even when a person has filtered to
"mine": the old code could not do this at all, since it filtered
ownership in JS after loading everything, then sliced.

## The backend

`workers/vf-app/src/task-list-route.ts` — `handleListMyTasks` rewritten
around three queries sharing one `joins` string and one
`baseWhereClause` string, the same "narrow once, reuse the identical
clause everywhere" shape decision 0448 established for Documents, using
this file's own **numbered placeholders** (`?1`…`?11`) for the first
time — `userId` (`?2`) is now genuinely reused across the team-
membership subquery and the ownership `CASE`, rather than bound twice
under two separate `?` occurrences the old positional style required.

- **`scopedPermissions`/`reachablePairs`** — computed once, before any
  query runs: for every permission held in specific units (not
  everywhere), the downward-reachable set from each held unit,
  flattened into `"<permission>|<unit>"` strings. Matched in SQL via
  `(t.required_permission || '|' || h.org_unit_id) IN (SELECT value
  FROM json_each(?))` — flat pair strings, not a nested JSON structure
  keyed by permission, because `IN (SELECT value FROM json_each(?))` is
  the one pattern this whole codebase already uses everywhere else for
  "match against a precomputed set," and a two-column match needs
  nothing more exotic than concatenating the pair on both sides. A
  nested `json_extract` with a dynamically-built path per permission
  was considered and rejected as a second, fragile idiom this codebase
  does not otherwise use.
- **`orgFocusReachable`** — the same downward-reachable-set shape,
  computed once for the chosen org (decision 0314/0315), applied as its
  own separate `AND` — there is no single `visibleUnits` list to
  intersect the way `scopedToChosenOrg()` does for Documents/Purchase
  Orders, since Tasks' visibility is per-permission rather than
  per-query, so the two checks (permission-scoped, org-focus) stay the
  two separate conditions `maySee()` always ran.
- **`ownershipCase`** — `CASE WHEN (owner_user_id = ?2 OR claimed_by =
  ?2) THEN 'mine' WHEN claimed_by IS NOT NULL THEN 'locked' ELSE
  'available' END`, reused three ways: filtering rows (`ownershipClause`,
  `= ?9`), and — after a real bug, below — computing the `mine`/
  `available`/`locked` counts.
- **`groupCountsRow`** — `SUM(CASE WHEN (...) THEN 1 ELSE 0 END)` over
  `baseWhereClause` **without** `ownershipClause`: the counts describe
  every kind the person could switch to, not only the one currently
  chosen, the same reasoning decision 0255 already established and
  decision 0448 restated for Documents' own count query.
- **`totalRow`** — `count(*)` over `baseWhereClause` **with**
  `ownershipClause`: the real total behind the page a person is
  actually looking at.
- **`rows`** — the page itself, `baseWhereClause` + `ownershipClause` +
  `ORDER BY t.created_at ASC LIMIT ?10 OFFSET ?11`.

**A real bug, caught by the pre-existing test suite, not invented for
this decision.** The first version of `groupCountsRow` restated the
ownership split as its own `NOT (...)` conditions instead of reusing
`ownershipCase`:

```sql
SUM(CASE WHEN t.claimed_by IS NOT NULL AND NOT (t.owner_user_id = ?2 OR t.claimed_by = ?2) THEN 1 ELSE 0 END) AS locked
```

For an unclaimed team task, `owner_user_id` and `claimed_by` are both
`NULL`, so `owner_user_id = ?2 OR claimed_by = ?2` evaluates to `NULL`
rather than `FALSE` — SQL's three-valued logic — and `NOT NULL` is
`NULL` again, not `TRUE`. The `CASE WHEN … AND NOT (…)` built that way
silently dropped the row from **every** branch rather than landing it
in `available`. `task-list-route.test.ts`'s own pre-existing "counts
each kind" test (predating this decision, not written for it) caught
this immediately: `{ mine: 1, available: 0, locked: 0 }` instead of
`{ mine: 1, available: 1, locked: 1 }`. Fixed by building
`groupCountsRow` on `ownershipCase` itself — `SUM(CASE WHEN
(${ownershipCase}) = 'mine' THEN 1 ELSE 0 END)` and so on — whose
sequential `CASE … WHEN … ELSE` has no such gap: each `WHEN` only has
to be `TRUE` to match, `NULL` falls through to the next `WHEN` exactly
like `FALSE` does, and the final `ELSE` catches everything else. The
same reasoning that already made `ownershipClause`'s own `= ?9`
comparison safe.

**Real pagination.** `page`/`pageSize` win over legacy `limit`/`offset`
when given (`usingPageParams`); when absent, `limit`/`offset` behave
exactly as before, which is what `dashboard-route.ts`'s own two
internal callers (both `limit: 1000`, no page controls) still rely on
— confirmed by grep, neither needed a change. Unlike Documents'
`paginating` gate, `total`/`page`/`pageSize` are **always** present in
the response body regardless of which path was used: `counts`/`total`
were already computed unconditionally before this decision, over a
full in-Worker scan strictly more expensive than the SQL that replaced
it, so there was never a cost reason to withhold them from a caller
that did not ask for a page — only a reason to make them cheaper.

**Search** — `taskSearchPattern()`, the same `%`/`_`/`\` escaping
`documentSearchPattern()` already applies. Matched against stage name
(`s.name`), supplier name (`json_extract(h.facts_json, '$."BT-27"')` —
the same fact `sellerNameOf()` already reads for display, not a
`suppliers` table join Tasks has never had), and amount (`CAST(h.
total_with_vat AS TEXT)`). Deliberately excludes invoice number, unlike
Documents: this screen has never selected or displayed it.

`workers/vf-app/src/index.ts` — the `/tasks` GET route gained `search`
(from `q`), `page`, `pageSize` passthrough to `handleListMyTasks`,
mirroring the existing `limit`/`offset`/`stage`/`ownership`/`org`
wiring already there.

## The frontend

`workers/vf-ui/public/tasks.js` — the same `documents.js` shape
decision 0448 established, applied to a file that is also this app's
own shell/nav/frame infrastructure (`documents.js` imports `el`,
`frame`, `topbar` from here), so the change touched every call site
that used to call the old, single-pass `loadTasks()`:

- **`loadTasks()` split into `load()` (fetch only, returns
  `true`/`false`) and `render()` (build the whole screen from module
  state)**, joined by a new `reload(focusId)` helper — load, re-render,
  re-focus. Every call site that used to call `loadTasks()` alone now
  calls `reload()` (the row click's close callback, `act()`'s claim/
  release and key-close paths, both filter selects' `onchange`); the
  two places that used to call `render(); await loadTasks();` in that
  order (`go()`'s fallback branch, `openDefaultScreen()`'s fallback)
  flip to `load()`-then-`render()`, since `render()` now reads `total`/
  `counts`/`page`/`pageSize` to build the pagination row and the counts
  line, and those only mean anything once `load()` has actually run —
  the identical order `documents.js`'s own `open()` already uses, for
  the identical reason. `refreshTask()` (exported for `viewer.js`'s own
  `runAction()`) calls `load()` alone, since the viewer — not `#shell`
  — has the screen at that moment, and there is nothing on screen for a
  render to usefully redraw.
- **The stale "patch the stage `<select>`'s own option in, then set the
  value" fix (decision 0359) is gone**, not merely unused: `render()`
  now rebuilds the stage `<select>` fresh from `knownStages` on every
  call, after `load()` has already updated it, so there is no longer a
  stale, already-built `<select>` for a new stage to be missing an
  `<option>` from.
- **`searchAndPaginationRow()`** — the same search input, page-size
  `<select>`, four `navButton()` icon buttons, and range span
  `documents.js` already builds, reusing `purchaseorders.rows`/
  `.firstpage`/`.previouspage`/`.nextpage`/`.lastpage`/`.rangeof`
  rather than a fourth near-identical set of keys. Only one new
  screen-specific string needed: `tasks.searchhint`.
- **The counts line no longer says "N shown."** That wording was
  honest when everything matching was shown, up to `limit`; now that
  paging is real, `total` means "matching across every page," and
  printing it beside "shown" would misstate what is actually on
  screen — exactly what the pagination row's own range text already
  states correctly. Rewritten as `tasks.countsline`, a translatable
  `{mine} mine · {available} available · {locked} held`, dropping the
  "shown" figure entirely rather than duplicating the range text in
  different words.
- **A real, independent bug, found by the browser test suite rather
  than guessed at.** `load()` calls `problem("")` on entry to clear any
  previous error message — harmless once the shell already exists, but
  `load()` now runs *before* the very first `render()`, so `#problem`
  does not exist yet the first time this runs, and `document.
  getElementById("problem").textContent = message` threw on a `null`.
  Fixed by guarding `problem()` itself: every call after the first has
  a real element to write into; only that first one needs the element
  to simply not exist yet, which is not an error.
- `openTasksFiltered()` now also resets `query`/`page`, matching
  `documents.js`'s own `openDocumentsFiltered()` — a stale search term
  or page number from a previous visit means nothing when a dashboard
  card sends somebody here with its own stage/ownership filter.

## Tests

`workers/vf-app/test/task-list-route.test.ts` — two new describe
blocks. **"searching — real SQL, decision 0449"**: finds by stage name,
supplier name, and amount; case-insensitive; `%`/`_` escaped rather
than treated as wildcards; returns nothing rather than everything on no
match; `total` narrows with a search term under real pagination.
**"real, server-side pagination — decision 0449"**: `total`/`page`/
`pageSize` always present (the genuine difference from Documents'
`paginating` gate, checked directly); `total` reflects every matching
row; page 2 disjoint from page 1; a real partial last page; a bad page
or page size normalized rather than erroring; every allowed page size
honoured; `page`/`pageSize` win over legacy `limit`/`offset` when both
are given; `page`/`pageSize` correctly derived from `limit`/`offset`
for a caller still using the legacy shape (`dashboard-route.ts`'s own
backward-compatibility guarantee, checked rather than assumed); and the
test that caught the `SUM`/`CASE` NULL-propagation bug above — `total`
computed under an ownership filter, in SQL, confirmed against the exact
counts a hand-traced fixture predicts.

`workers/vf-app/test/scoped-roles.test.ts` — **already had thorough,
pre-existing coverage** of the permission-unit-scoping (decision 0202)
and org-focus (decision 0314) visibility this decision rearchitected —
46 tests, all passing unchanged against the new SQL, which is itself
the strongest evidence the upward-walk-to-downward-walk equivalence
above is correct in practice and not merely on paper. Two new tests
added to a new describe block, **"search stays inside what visibility
already narrowed to (decision 0449)"**: a search term matching tasks in
both France and Germany, with the permission held only in Germany,
returns only the German one; the same with the permission held
everywhere but the org focus narrowed to Germany — checking directly
that free-text search, now living in the same `WHERE` as both
visibility layers, narrows *within* them rather than `OR`-ing its way
around either, the same composition risk decision 0448's own "composes
with the org focus" test already checked for Documents.

`workers/vf-ui/test-browser/tasks.test.ts` — two new describe blocks
mirroring `documents.test.ts`'s own decision-0448 additions, adapted to
Tasks' own control ids (`tasksearch`/`taskrowsize`) and endpoint:
search box placeholder, re-fetch with the term and reset to page 1,
focus kept after a search, a distinct no-matches message, search
composing with the existing stage/ownership filters (a Tasks-specific
addition Documents' equivalent tests have no analogue for), every
offered page size, changing page size re-fetches and resets to page 1,
first/previous/next/last button enabled state at each edge, the range
text, clicking next while keeping the same search term, and the counts
line reporting `mine`/`available`/`locked` rather than a page-relative
total. 12 new tests; 84/84 in this file, all green.

`workers/vf-licence/migrations/0151_tasks_search_and_pagination_strings.sql`
— three new keys: `tasks.searchhint`, `tasks.nomatch`, and
`tasks.countsline`; the pagination controls themselves need no new
keys, already reusing `purchaseorders.*`. `string-coverage.test.ts`'s
`KEYS_THE_INTERFACE_USES` and `test/setup.ts`'s own migration-import
list both updated; `apply_migrations.py --replay-only
--migrations-dir workers/vf-licence/migrations` confirms all 151
migrations replay clean with every assertion held.

`eslint` clean across every file this decision touched. `tsc --noEmit`
in `vf-app`: no error in `task-list-route.ts` or `index.ts`; every
other error is the same pre-existing baseline decision 0448 already
confirmed (the `cloudflare:test` module-resolution errors, and a
handful of unrelated `ap-assistant.ts`/`coding-list-route.ts`/
`ledger-route.ts` narrowing errors untouched by this decision).

Full, unfiltered suites where the tool timeout allowed: `vf-app`
**test/task-list-route.test.ts 67/67**, **test/scoped-roles.test.ts
48/48**, **test/dashboard.test.ts 64/64** (`dashboard-route.ts`'s own
backward-compatibility callers), **test/documents.test.ts 66/66**,
**test/ap-assistant.test.ts 68/68**, and **test/session-routes.test.ts
15/15** (the one file exercising `/tasks` at the full HTTP-route
level) run directly — the whole-repo `vf-app` suite (113 files, ~2618
tests) again could not complete inside this session's own tool
timeout, the same limitation decision 0448 already documented; every
file this decision actually touches, plus every file at plausible risk
of a regression, was run instead, and decision 0447 already confirmed
the full suite as a clean 2618/2618 baseline with none of them changed
since. `vf-licence` **320/320** (21 files, +1 migration file and its
3 new strings). `vf-ui`: **74/74** Worker (2 files, unchanged);
browser **1034/1034** (48 files, 1022 carried over from decision
0448's own confirmed baseline + 12 new in `tasks.test.ts`) — the
previously-documented, pre-existing unhandled-rejection flake (160
non-fatal logged errors across the whole browser suite) is present at
the identical count this decision's own runs show, confirmed by
running the unmodified baseline side by side with the same result,
and is untouched by this decision.

## What was not built

- **No delete, no bulk action** — out of scope, unrelated to search or
  pagination, and Tasks never had either before this decision.
- **Invoice number is not a search field here** — deliberately, since
  this screen has never selected or displayed it (unlike Documents,
  where it is the primary identifying column). Adding it would be
  scope creep beyond "search matches what's shown."
- **No shared helper for the flat-pairs SQL technique** — it exists
  only in `task-list-route.ts`, matching this codebase's own stated
  precedent of local duplication over premature sharing (the same
  reasoning `ALLOWED_PAGE_SIZES`/`normalizePage()`/`normalizePageSize()`
  are duplicated a fourth time here rather than factored out).

## Still to do, operator side

Built, tested, and delivered as a bundle. Not yet confirmed pushed and
deployed — awaiting the operator's own check, the same two-step
confirmation pattern decisions 0447 and 0448 both went through. One
new migration to apply: `0151_tasks_search_and_pagination_strings.sql`.
