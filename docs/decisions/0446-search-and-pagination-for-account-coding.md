# 0446 — Search and Real Pagination for Account Coding

**Status: built, tested, confirmed pushed and deployed** — `origin/main`
fetched directly reads `3f530f6`, matching this session's own commit
exactly, and the operator confirmed with *"deployed and pushed - looks
good."* Delivered as a git bundle for the operator's own
pull/push/deploy sequence, the same path decisions 0391, 0415–0445
already used. **Migration `0149` still needs its own separate
`apply_migrations.py --remote` run — see "Still to do, operator side"
below.**

---

## What was asked

*"I would like to see the table for Tasks, Documents, and the new
tables in the AP Setup, Account Coding tab to support pagination, and
search in a similar way that the purchase orders and supplier pages
do."*

Three clarifying questions were asked before any code was written,
since the request named three genuinely different screens whose
current implementations turned out not to be equally close to Purchase
Orders' own precedent:

- **Sequencing.** Answered: Account Coding first, shipped as its own
  decision; Tasks and Documents deferred to a separate, future decision
  — not because they matter less, but because (see "What was found,
  not built" below) both need a real architectural change first, not
  just a UI layer added on top.
- **Account Coding's own Project hierarchy vs. pagination.** A
  paginated table can split a parent from its child across two pages,
  so the existing client-side "indent under your parent" display
  cannot stay as it was. Answered: paginate it exactly like the other
  three tables — a child still shows its parent's name in a column,
  just not indented under it.
- **Tasks and Documents' own future approach**, asked now only to
  record for whoever picks up that later decision, not built here:
  answered as a full rebuild onto real, SQL-pushed pagination and
  search matching Purchase Orders/Suppliers exactly, rather than
  layering page/search controls on top of either screen's current
  in-Worker computation.

**Confirmed scope**: search plus real, server-side pagination for the
Account Coding tab's four manageable tables — Cost Centre, Project,
Commodity Code, General Ledger Code. Company code (read-only, backed by
`org_units`, decision 0444's own explicit exclusion) is untouched —
there is nothing to page through. Tasks and Documents are out of scope
entirely.

## What was found, not built

Before writing anything, all three named screens' own current
implementations were checked directly against what "in a similar way
that the purchase orders and supplier pages do" would actually require:

- **Purchase Orders' own precedent** (decision 0376,
  `purchase-order-route.ts` / `load-suppliers.ts`): real SQL search
  (`LIKE ... ESCAPE '\\'`, `%`/`_`/`\` escaped) plus `LIMIT`/`OFFSET`
  pagination, a second `count(*)` query for a real `total`, and one
  shared frontend pattern (`searchAndPaginationRow()`) with page-size
  and page-nav controls.
- **Tasks** (`task-list-route.ts`): row visibility is computed
  **in-Worker**, per row, via an async permission check plus an
  org-unit-lineage walk (`maySee()`) — not expressible as a SQL
  `WHERE` clause without a much larger change. `limit`/`offset`
  already exist server-side but `tasks.js` never sends them, and there
  is no search at all. Real pagination here means rebuilding how
  visibility is computed, not adding query params.
- **Documents** (`documents-route.ts`): SQL fetches up to `limit`
  (capped, default 50) most-recent rows, and the existing `q` search
  parameter is then applied **in-Worker**, against fields already
  parsed out of `facts_json` on the rows already loaded — a documented,
  deliberate limitation ("searches only what was loaded"), not a bug.
  There is no true offset-based pagination underneath it at all.
- **Account Coding** (`coding-list-route.ts`, `ledger-route.ts`): fully
  unbounded and unpaginated — every entry of every list, always. The
  closest of the three to Purchase Orders' own shape, and the only one
  where "add real SQL search and pagination" is genuinely additive
  rather than a rewrite.

This is why the confirmed scope above is what it is: Account Coding
could take the same treatment Purchase Orders already has; Tasks and
Documents cannot, without first deciding how much of their own current
architecture to keep.

## The backend

`workers/vf-app/src/coding-list-route.ts` — `handleListCodingListEntries`
gains `search`, `page`, `pageSize`, and `all` parameters (all optional,
defaulting to the previous unpaginated behaviour's absence). `ALLOWED_
PAGE_SIZES = [25, 50, 100, 200]`, `DEFAULT_PAGE_SIZE = 50`,
`normalizePage()`/`normalizePageSize()`, and `codingListSearchClause()`
are the same shapes `purchase-order-route.ts` already established for
decision 0376 — locally duplicated, not shared, matching that file's
own precedent of not factoring this into a shared helper. The search
clause matches `e.id`, `e.name`, the resolved approver name (`a.name`),
and the resolved parent name (`p.name`) — every column the table
itself shows, not just the two the row stores directly. `total` is a
second, real `count(*)` query, run against the same joins and search
clause as the page itself.

`workers/vf-app/src/ledger-route.ts` — `handleListCostCentresDetailed`
gets the identical treatment (`costCentreSearchClause()`, matching
`c.id`/`c.name`/`u.name` (owner)/`p.name` (parent)), no `all` mode
needed (see below).

**`all=1` — a bypass, not a fifth parameter that means something
different.** A create/edit form's own parent picker (and, for General
Ledger Code, its own Commodity Code filter picker) needs every entry
to choose from, not one page of them. Rather than give the frontend a
second, different fetch shape to maintain, `handleListCodingListEntries`
answers `all=1` by skipping the `count(*)` query entirely and returning
every row unpaginated, with `total` simply the length of what was
returned and `page` fixed at 1 — same endpoint, same response shape,
one flag. `handleListCostCentresDetailed` has no equivalent, because
its own picker need is solved differently (see "The picker problem"
below) — nothing reads the full Cost Centre table any more.

`workers/vf-app/src/index.ts` — `GET /coding-lists/:type` and
`GET /org/cost-centres` now read `search`/`page`/`pageSize` (and, for
the former, `all`) off `url.searchParams` and pass them through.

## The picker problem, and how each of the four tables solves it

A page of 50 rows is the right thing for a table. A parent-picker
dropdown, or General Ledger Code's own Commodity Code filter picker,
needs every possible value — paginating a picker would silently hide
valid choices past page one. Four different tables, two different
answers:

- **Cost Centre.** Its own parent picker now reads `/org/overview`'s
  pre-existing lightweight `costCentres: [{id, name}]` list — already
  fetched for other pickers across the app, so this is zero new
  fetches, not a new one. Confirmed directly (`ledger-route.ts`'s own
  header comment) that this list stays intentionally lighter than the
  Account Coding table's own richer, resolved-name shape.
- **Project, Commodity Code, General Ledger Code.** Each entry form's
  own parent picker (and GL Code's Commodity Code filter picker) is
  populated by a **lazy, on-demand fetch** — `?all=1` — fired only when
  that create/edit form is about to open, never cached, never kept
  loaded for the whole screen visit the way the table's own former
  eager, unpaginated fetch used to double as this data source.

## The frontend

`workers/vf-ui/public/coding-lists.js` — substantially rewritten.

**The module now owns its own per-table state**, rather than
`ap-setup.js` eagerly fetching everything up front and handing it down
as props — the same shift `purchase-orders.js`/`suppliers.js` already
made when their own pagination arrived (decision 0376), since paging
or searching one table must no longer mean re-fetching or re-rendering
the whole screen. `tableState`, keyed by list type
(`{search, page, pageSize, total, rows, declaredFilters}`), plus
`loadTable()` (one table's own page, from the database),
`loadFullEntries()` (a lazy, uncached `?all=1` fetch, for a form's own
pickers), and `reloadTable()` (redraw one tab in place after a change,
by finding a stable container id — `#codingactivetab` — rather than
holding a reference to it, the same "found by id, not held as a stale
reference" fix `csvLoaderPanel`'s own note box needed in decision
0445, applied here to a whole section).

`searchAndPaginationRow(listType)` mirrors `purchase-orders.js`'s own
`searchAndPaginationRow()` closely, parameterised by list type since
all four tables share one component rather than four near-identical
copies. It reuses that same component's own **generic** strings —
`purchaseorders.rows`, `.firstpage`, `.previouspage`, `.nextpage`,
`.lastpage`, `.rangeof` — rather than four new, identically-worded
apsetup-specific copies, matching this project's own established
naming discipline (decision 0445's `.poformat` → `.csvformat`: "a
generic style rule/string no longer carries one feature's own name").
Only two genuinely new keys were needed:
`apsetup.codingsearchplaceholder` and `apsetup.codingnomatches`.

**The indent-by-depth on Project's own hierarchy is gone entirely.**
The old `entryDepth()` walked a parent chain within whatever array was
already loaded client-side. With pagination, a child's true parent may
simply not be on the current page — `entryDepth()`'s own `while` loop
increments `depth` before checking whether the parent lookup actually
succeeded, so a split-across-pages parent/child pair would have
rendered a **confidently wrong partial indent**, not an honestly empty
one. Better no indent at all than a wrong one: the existing "Parent"
column, already sourced from the server's own resolved name rather
than a client-side lookup, is unaffected either way and stays the
accurate, always-correct answer to "whose child is this."

`openCodingEntryEditor()` (new) — the async wrapper around opening a
create/edit form for Project/Commodity Code/General Ledger Code.
Fetches this list's own full entries (`?all=1`, for the parent picker)
and, only when this type declares a `commodity_code` filter (i.e. only
for GL Code), that list's own full entries too — both in parallel,
both awaited before the form itself ever opens. A fetch failure
degrades to the table's own last-known `declaredFilters` and empty
picker options rather than refusing to open the form at all, the same
"a helper affordance's own failure blocks only itself" choice
`loadCodingListCsvFormats()` already makes for the Template button.
Cost Centre's own form-opening stayed synchronous — no fetch needed,
since its picker reads the already-cached `costCentreNames`.

`loadAccountCodingTables()` (new, exported) — pages one of all four
tables at their own default search/page/size, called from
`ap-setup.js`'s own `load()` alongside the pre-existing
`loadCodingListCsvFormats()`, the same "in its final state by the time
`render()` runs" discipline that function's own comment already
describes. A failed fetch leaves that one table's own
`freshTableState()` defaults in place (empty rows, `total: 0`) rather
than throwing.

`workers/vf-ui/public/ap-setup.js` — `load()` no longer fetches
`/api/org/cost-centres` or the three `/api/coding-lists/:type` routes
directly; those are now `coding-lists.js`'s own concern via
`loadAccountCodingTables()`. What this file keeps is the one thing
`coding-lists.js` cannot get anywhere else — `/org/overview`'s own
lightweight `costCentres` list — captured into a new `costCentreNames`
module variable and passed through to `accountCodingTab({units, users,
costCentreNames, rerender})` (dropped: `costCentres`, `codingLists`,
`refresh` — no longer needed now that `coding-lists.js` owns its own
data and its own targeted re-render).

## Tests

`workers/vf-app/test/coding-list-route.test.ts` (+17 tests) — three
new describe blocks: searching (id/name/approver-name/parent-name
matches, literal `%`/`_` treated as themselves, empty-not-error on no
match), real pagination (default/explicit page size, no-overlap
page 2, a real partial last page, normalisation of a bad page or page
size, every allowed page size, `total` reflecting every matching row
including under a search term), and the `all` bypass mode (ignores
page/pageSize, still honours search, runs no count query — `total`
equals the returned entries' own length).

`workers/vf-app/test/accounting-frame.test.ts` (+14 tests) — the
identical treatment for `handleListCostCentresDetailed`, in a new
"searching the Cost Centre list" and "real, server-side pagination for
Cost Centre" pair of describe blocks.

`workers/vf-ui/test-browser/coding-lists.test.ts` (20 → 31 tests) —
three pre-existing tests updated for the new async form-opening
behaviour (`openCodingEntryEditor()`'s own lazy `?all=1` fetch means a
test must now await a tick after clicking Add/Edit before the form
itself appears — it did not need to before); the old "indents a child
entry" test replaced with one confirming no indentation and a correct
Parent column instead; a new "searching and paginating a coding list"
describe block (search box placeholder/id, re-fetch with the term and
reset to page 1, focus kept after a search, the distinct no-matches
message, every offered page size, first/previous/next/last button
enabled state at each edge and in the middle, the range text, and
clicking next keeping the same search term) mirroring
`purchase-orders.test.ts`'s own "searching the list"/"pagination
controls" blocks; and a new "a create/edit form's own pickers see
every entry, not just the current page" describe block, proving Cost
Centre's picker sees a cost centre absent from the table's own current
page (since it reads `/org/overview` instead) and that a coding list's
own parent picker is fetched fresh with `all=1`, independent of
whatever the table's own current page held.

`workers/vf-ui/test-browser/ap-setup.test.ts` — unchanged. Its own
existing stubs (`/api/org/cost-centres`, the three
`/api/coding-lists/:type` routes) already match what
`loadAccountCodingTables()` fetches, since the harness's own
`stubFetch()` matches routes by path with the query string stripped;
confirmed by running this file's full suite unmodified before touching
anything else — all 20 tests passed against the rewritten
`coding-lists.js` without a single edit needed here.

`workers/vf-licence/migrations/0149_account_coding_search_and_
pagination_strings.sql` (new) — the two genuinely new keys × 2 locales
(4 rows). Wired into `test/setup.ts` and `string-coverage.test.ts`'s
own `KEYS_THE_INTERFACE_USES`, following the exact pattern established
for migrations 0147/0148. Its string values were written with an em
dash and no literal semicolons, avoiding decision 0445's own found
`toOneStatementPerLine()` test-harness limitation.

**A second, unrelated pre-existing gap found and fixed along the way,
not left for later:** `workers/vf-ui/test-browser/tasks.test.ts`'s own
copy of the "list every nav item" tests never had `nav.apsetup` added
to its `STRINGS` fixture or "AP Setup" added to its expected arrays —
the exact same class of gap decision 0441 already found and fixed in
`rules.test.ts`'s own sibling copy of this same test, but this second
copy was missed at the time. Confirmed pre-existing and unrelated to
this decision via `git stash` against the unmodified baseline before
touching it. Fixed: `nav.apsetup` added to the fixture; "AP Setup"
added (in `NAV_GROUPS`'s own order — after Access, before Sources) to
the three affected expectations ("every permission held," "Admin.
RuleManagement missing," and "Admin.Configure unlocks... together");
the nav-item icon count updated from 10 to 11.

`eslint .` clean across every file this decision touched or added,
verified per-workspace along the way and again at the end.

`npx tsc --noEmit` in `vf-app` — no new errors. The three pre-existing
errors this decision's own edited files still surface
(`coding-list-route.ts`'s `wouldCycle()` implicit-any, `ledger-route.ts`'s
two `filtersResult` narrowing errors) were confirmed, via `git stash`
against the unmodified baseline, to already exist there — unchanged by
this decision, just shifted to new line numbers by the additions
around them.

Full, unfiltered suites: `vf-app` **2618/2618** (113 files, +31 over
decision 0445's 2587 — 17 in `coding-list-route.test.ts` and 14 in
`accounting-frame.test.ts`). `vf-licence` **320/320** (21 files, unchanged count
— this decision's own migration adds rows, not new *tests*).
`vf-ui`: **74/74** Worker (2 files); browser **1011/1011** (48 files,
996 pre-existing carried over from decision 0445's own baseline + 11
new in `coding-lists.test.ts`), all green — the previously-documented
`document-window.test.ts` unhandled-rejection flake is still present
(160 non-fatal errors logged, same as the confirmed baseline) but no
longer causes a failed assertion anywhere, now that the `tasks.test.ts`
gap above is fixed too.

`python3 migrations/apply_migrations.py --replay-only` — clean, `vf-app`
chain: 76 migrations, unchanged this decision (no new vf-app
migration), 170 standing invariants re-checked. `vf-licence`'s own
149-migration chain has no equivalent Python replay (it is validated
through `test/setup.ts` + `string-coverage.test.ts` instead, both run
above).

## What was not built

- **Tasks and Documents** — explicitly deferred to a separate, future
  decision per the operator's own chosen sequencing above. That future
  decision's own preferred approach (also asked now, for the record):
  a full rebuild onto real, SQL-pushed pagination and search matching
  Purchase Orders/Suppliers exactly, not a thin layer of page/search
  controls over either screen's current in-Worker computation.
- **No delete anywhere in this decision** — matches decision 0444's
  own existing gap for these four lists, unchanged.
- **No caching of a picker's own `?all=1` fetch** — deliberate, not an
  oversight. A cached copy could grow stale the moment another operator
  (or this same operator, via CSV load) adds an entry mid-visit; a
  fresh fetch right before the form opens is one extra request in
  exchange for never showing a stale picker.

## Still to do, operator side

Confirmed pushed and deployed. Migration `0149` is **not yet applied to
any live database** — it has only been replayed via
`test/setup.ts`/`string-coverage.test.ts`. Per this session's own
now-four-times-repeated finding (migrations 0075, 0076, 0146, 0148: a
deploy and a migration apply are two separate steps here, and skipping
the second one produces raw-string-key UI, not an error), the
operator's own next step is:

```
apply_migrations.py --remote --database vf-licence-poc --migrations-dir workers/vf-licence/migrations
```
