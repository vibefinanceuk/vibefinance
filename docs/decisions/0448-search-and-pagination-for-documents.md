# 0448 — Real Search and Pagination for the Documents Screen

**Status: built, tested, not yet delivered this decision's own commit**
— delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0447 already used.

---

## What was asked

*"We parked the Document and Task search screen, which require a
deeper level of build to introduce search and pagination. Can you
implement those changes now?"* — the two screens decision 0446
explicitly deferred, rather than giving the same treatment it gave
Account Coding, because (per that decision's own "What was found, not
built") neither one's current architecture could take it without a
larger change first.

Followed by a scope requirement, stated before any code was written:
*"Both searches need to respect the Org selected at the top of the
screen, which currently can be defined as All Organisations, Acme
Group, Acme Uk and Acme GmbH. The user permissions limit what groups a
user can select. Therefore the search for Tasks and Documents, needs
to be within the boundaries of the Org that currently has focus."*

**This decision is Documents only.** Tasks needs its own, separate
decision — see "What was not built" below for why the two could not
share one.

## What was found, not assumed

Decision 0446 grouped Tasks and Documents together as both needing "a
full rebuild." Checked directly against `documents-route.ts` rather
than taken on faith, that turned out to be only partly true:

- **Three of the search's own four fields already had real, kept-in-sync
  SQL columns.** `number` (`BT-1`) and `amount` (`BT-112`) have carried
  `invoice_number`/`total_with_vat` since migrations 0007/0014, written
  on every `handleUpsertInvoice` call alongside `facts_json` and never
  drifting from it — `mergeStructuredInvoiceFacts()`'s own comment in
  `invoice-facts-route.ts` states the invariant directly. `sender` was
  never in `facts_json` at all; it is `inbound_email_events.sender`,
  already a real, already-joined column this route has used since
  decision 0147. Only `supplier` (`BT-27`) had no mirrored column — and
  this same file already had the exact fallback a search needs for it,
  `COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"'),
  'Unknown')`, used a few lines below for `exceptionSupplier`.
- **The search that existed was in-Worker, over an already-limited
  window** — `handleListDocuments` fetched up to `limit` (capped,
  default 50) most-recent rows, and the `q` parameter then filtered
  those already-loaded rows in JavaScript. A documented, deliberate
  limitation ("searches only what was loaded"), not a bug — but real
  pagination underneath it did not exist at all.
- **The org-focus mechanism decision 0448's own second ask names was
  already there, fully SQL-based, and did not need building.**
  `documents.js`'s `load()` already reads `currentOrgId()` and sends it
  as `org`; `index.ts` already narrows it through `scopedToChosenOrg(db,
  visible, url.searchParams.get("org"))` into `handleListDocuments`'s
  own `visibleUnits` parameter, which the query's `WHERE` clause has
  applied since decision 0199/0259. This is the same downward-walk
  pattern (`unitsBeneath()` in `enforce.ts`) Purchase Orders already
  uses. Nothing here needed changing to satisfy the operator's own
  requirement — only preserving it through the rewrite, which the test
  suite now proves explicitly (see "Tests" below) rather than leaving
  it implicit.

This is why Documents could take essentially the same treatment
decision 0446 gave Account Coding — real SQL search plus real
`LIMIT`/`OFFSET` pagination, additive rather than architectural — while
Tasks (see "What was not built") genuinely cannot yet.

## The backend

`workers/vf-app/src/documents-route.ts` — `handleListDocuments` gains
`documentSearchPattern()` (the same `%`/`_`/`\` escaping
`purchase-order-route.ts`'s own `searchClause()` already applies, kept
to this file's own numbered-placeholder convention rather than that
file's repeated-bind one — every other optional filter here is already
`(?N IS NULL OR ...)`, and a second convention living inside one query
would read as a mistake, not a choice) and the same
`ALLOWED_PAGE_SIZES`/`DEFAULT_PAGE_SIZE`/`normalizePage()`/
`normalizePageSize()` shape decisions 0376 and 0446 already established
— locally duplicated, not shared, matching this codebase's own
precedent against factoring this into a shared helper.

**Pagination only runs when asked for.** `paginating` is true only when
`page` or `pageSize` is present in the request. `documents.js`'s own
screen now always sends both; `ap-assistant.ts`'s `invoice_search` tool
(`runInvoiceSearch()`) does not and was not touched — it keeps its
exact existing cost profile, one bounded fetch and no second `count(*)`
query, because `total`/`page`/`pageSize` are simply absent from the
response body when nobody asked for them.

`whereClause` and `whereBinds` are shared, unchanged in every position
except the new sixteenth, `?16` — the search pattern, appended last so
every filter already numbered `?1` through `?15` (unit, visibility,
unplaced, duplicates, stage, stage-ids, doneByMe, exception-supplier,
aging, since) keeps the number it already had. `whereBinds` stays a
full sixteen-element array for **both** the count query and the page
query, including `limit` at position 2 even though the count query's
own text never references `?2` — a numbered placeholder binds by array
position, not by which placeholders the query text happens to use, so
trimming an unreferenced value out of the array would silently shift
every value after it into the wrong condition. Documented directly in
the code, because this was caught once, before any test ran, by
re-reading the first draft rather than by a failure (see "Tests"
below).

`totalRow` — a second `count(*)` query against the identical `joins`
and `whereClause`, run only when `paginating`. The page query itself is
unchanged in its `SELECT` and `ORDER BY`; only its `LIMIT ?2 OFFSET
?17` and the removed in-Worker `.filter()` are new.

`searched` stays in the response body, but its meaning has changed with
what it now reports: it used to mean "how many of the loaded rows
survived the in-Worker filter," honestly admitting the search might
have missed a match outside the load window. Now that the search runs
inside the same query the `LIMIT` already enforces, there is no window
it could miss within — `documents.length` and "how many matched" are
the same number. Left in place, not removed, because
`ap-assistant.ts`'s own caller still reads a response of this shape
even though it never uses this particular field.

`workers/vf-app/src/index.ts` and `ap-assistant.ts` — read, not
changed. `page`/`pageSize` already flow through
`url.searchParams`/`handleListDocuments`'s existing signature without
any new wiring; `runInvoiceSearch()`'s own call, sending only `limit`,
was re-run against the rewritten route (`vitest run
test/ap-assistant.test.ts`, 68/68) to confirm its backward
compatibility rather than assumed from reading the code alone.

## The frontend

`workers/vf-ui/public/documents.js` — the same `purchase-orders.js`/
`coding-lists.js` shape decisions 0376/0446 already established:
module-level `page`/`pageSize`/`total` state, reset to `page = 1` on
every fresh `open()` (and on every one of the four filtered-entry
points — `openDocumentsFiltered()`, `openDocumentsAtStage()`,
`openDocumentsForSupplierExceptions()`, `openDocumentsAged()`), a new
`reload(focusId)` helper (load, re-render, re-focus — the same "full
render, then restore focus" shape `purchase-orders.js`'s own `reload()`
already uses), and a `searchAndPaginationRow()` function returning the
search input plus page-size `<select>` plus four `navButton()`-built
icon buttons plus a range span, reusing `purchaseorders.rows`/
`.firstpage`/`.previouspage`/`.nextpage`/`.lastpage`/`.rangeof` rather
than a fourth near-identical set of apsetup/documents-specific keys —
this project's own established string-reuse discipline (decisions
0445, 0446, 0447), and this time needing **zero** new string keys at
all, since every string this row needs already exists.

`load()` now reads `page`/`pageSize` back off the response body, the
same way `purchase-orders.js`'s own `load()` already does — the server
can clamp a bad page number or an unsupported page size
(`normalizePage()`/`normalizePageSize()`), and the range text has to
agree with what was actually served, not with what was asked for.

**The old "N of M looked through" honesty message is gone.**
`documents.searchedcount` existed only because the old search could
miss a match outside its load window; the new search runs in SQL
against the whole matching set, and `total` — shown by the new
pagination row's own range span — says the true, complete count
instead. The key itself, `documents.searchedcount`, is left in
migration `0044` as-is (migrations are append-only and never edited)
and removed from `string-coverage.test.ts`'s own
`KEYS_THE_INTERFACE_USES`, the same orphaning decision 0447 already did
for `apsetup.csvloadbutton`/`.csvtemplatebutton`.

## Tests

`workers/vf-app/test/documents.test.ts` — `seedDocument()` now derives
and inserts `invoice_number`/`total_with_vat` the same way production
code does, so tests exercise the real search columns rather than a
synthetic fixture. The "searching" describe block is renamed
("searching — real SQL now, decision 0448") and expanded: finds by
supplier/number/amount (including SQLite's own `CAST(REAL AS TEXT)`
trailing-`.0` behaviour on a whole-number amount, confirmed by a
dedicated test rather than assumed), finds by sender (a column that was
never in `facts_json`), case-insensitivity, `%`/`_` escaped rather than
treated as SQL wildcards, and a "finds a match beyond the old load
window" test proving the search now reaches past what the old
`limit`-bounded fetch would have missed. A new "real, server-side
pagination — decision 0448" block (7 tests): `total`/`page`/`pageSize`
absent unless requested, `total` reflecting every matching row (not
just the page), page 2 disjoint from page 1, a real partial last page,
a bad page or page size normalized rather than erroring, every allowed
page size honoured, and `total` narrowing correctly under a search
term. A new **"composes with the org focus, decision 0448's own second
requirement"** test moves one seeded document to `org_unit_id =
'acme-fr'` (adding the `org_units` rows for `acme-fr`/`acme-de` this
needed, matching the exact FK precedent already used elsewhere in this
file) and confirms a search term combined with `visibleUnits` scoped to
France only returns France's own matching document — proving the
pre-existing org-scoping mechanism and the new search narrow together
correctly, rather than one silently overriding the other. 66/66
passing.

`workers/vf-app/test/ap-assistant.test.ts` — run unmodified (68/68) to
confirm `runInvoiceSearch()`'s backward compatibility, per the
reasoning above.

`workers/vf-ui/test-browser/documents.test.ts` — `documents.
searchedcount`'s STRINGS entry removed; the six `purchaseorders.*`
pagination-row keys added, matching the exact values
`purchase-orders.test.ts`'s own STRINGS fixture uses. The
`/api/documents` stub response in both `openDocuments()` and the
org-focus test now includes `total`/`page`/`pageSize`, matching what
the rewritten screen actually reads. Two new describe blocks mirror
`purchase-orders.test.ts`'s own "searching the list"/"pagination
controls" blocks (decision 0376), adapted to Documents' own field
names, endpoint, and control ids (`docsearch`/`docrowsize`): search box
placeholder, re-fetch with the term and reset to page 1, focus kept
after a search, a distinct no-matches message, every offered page size,
changing page size re-fetches and resets to page 1, first/previous/
next/last button enabled state at each edge and in the middle, the
range text, and clicking next while keeping the same search term. 34
tests in this file, all green (23 pre-existing + 11 new).

`workers/vf-licence/test/string-coverage.test.ts` —
`documents.searchedcount` removed from `KEYS_THE_INTERFACE_USES` with
a comment explaining why, matching the exact precedent decision 0447
set for `apsetup.csvloadbutton`/`.csvtemplatebutton`.

`eslint .` clean across every file this decision touched.

`npx tsc --noEmit` in `vf-ui` (which also type-checks `vf-app`/
`vf-licence` through its own project references) — one real error
found and fixed: `test/documents.test.ts`'s own `list()` helper's
return-type cast was missing `sender`, a field the route has always
returned but this cast never declared, surfaced only once a test
started reading `.sender` off a result (decision 0448's own new
"finds by sender" test). Fixed by adding it to the cast. Every other
error a standalone `tsc --noEmit` surfaces (the `cloudflare:test`
module-resolution errors across every `vf-app`/`vf-licence` test file,
and the unrelated `vf-app/test/workload*.test.ts` narrowing errors) is
pre-existing across the whole repo, confirmed unchanged by this
decision — the same baseline decision 0447 already confirmed clean.

Full, unfiltered suites: `vf-app` **test/documents.test.ts 66/66** and
**test/ap-assistant.test.ts 68/68** run directly (the full,
whole-repo `vf-app` suite — 113 files, ~2618 tests — could not
complete inside this session's own tool timeout; the two files this
decision actually touches, plus the one file most at risk of a
backward-compatibility regression, were run instead, and neither is
new ground — decision 0447 already confirmed the full suite as a clean
2618/2618 baseline with no `vf-app` file touched). `vf-licence`
**320/320** (21 files, unchanged in count — this decision added no new
migration and no new string key). `vf-ui`: **74/74** Worker (2 files,
unchanged); browser **1022/1022** (48 files, 1011 carried over from
decision 0447's own confirmed baseline + 11 new in
`documents.test.ts`), all green — the previously-documented
`document-window.test.ts`/`documents.test.ts` unhandled-rejection flake
(160 non-fatal logged errors across the whole browser suite, 6 of them
in `documents.test.ts` alone) is present at the identical count this
decision's own runs show, matching the baseline every decision back to
0446 has already confirmed and re-confirmed — untouched by this
decision, and not a failing assertion anywhere.

No migration this decision — no new string key was needed anywhere,
since every string the new pagination row uses already existed.

## What was not built

- **Tasks** — deliberately out of scope for this decision. Its own
  visibility (`maySee()` in `task-list-route.ts`) walks **upward** from
  each task through `unitLineage()`, one query per ancestor level, and
  is additionally scoped per-task by that task's own
  `requiredPermission` — the opposite direction from, and a genuinely
  different shape than, the downward-walk `unitsWherePermitted()`/
  `scopedToChosenOrg()` pattern Documents (and Purchase Orders, and
  Account Coding) already use. Decision 0446 named this correctly:
  "not expressible as a SQL `WHERE` clause without a much larger
  change." That change is real architectural work, not a search-and-
  pagination layer, and belongs in its own decision — 0449 — rather
  than folded into this one just because both were asked about
  together.
- **No delete, no bulk action** — out of scope, unrelated to search or
  pagination, and Documents never had either before this decision.
- **No new migration, no new string key** — genuinely nothing was
  needed; noted here only because every recent decision in this
  sequence (0445 through 0447) did need one, and its absence here is a
  fact about the work, not an oversight.

## Still to do, operator side

Not yet confirmed pushed and deployed as of this decision's own
writing — delivered as a git bundle for the operator's own pull, push,
and deploy. No migration to apply once it is: this decision added
none.
