# 0445 — CSV Template and Load for Cost Centre, Project, Commodity Code, and General Ledger Code

**Status: built, tested. Not yet pushed or deployed** — this session
still has no push access to `vibefinanceuk/vibefinance`; delivered as a
git bundle for the operator's own pull/push/deploy sequence, the same
path decisions 0391, 0415–0444 already used.

---

## What was asked

*"Please could I ask that for Cost Center, Project, Commodity Code and
General Ledger Code we introduce a CSV Template, and Load CSV icons and
capability, similar to how we have done for Loading purchase orders.
Manually adding and maintaining is available, but I think manual
changes this way will be minimal."*

Two points were confirmed directly rather than assumed, before any code
was written:

- **Company code is excluded.** *"The Company Code is generated from
  the Orgs, I think"* — correct, and consistent with decision 0444's
  own read-only treatment of it: Company code is `org_units`, not a
  `coding_list_entries` row, so there is nothing for a CSV load to
  create or update.
- **Cost Centre's own two real shape differences from the other
  three** (see "What was found" in decision 0444 — it has no
  `is_default` column, and `handleUpdateCostCentre` has never taken a
  `name` field): asked directly via a clarifying question, rather than
  guessed. Answer: match the other three lists' CSV column shape
  exactly (same "Approver"/"Default" columns on every export, one
  format across all four lists) — "Approver" maps to Cost Centre's own
  owner under the hood, and a Default value in a Cost Centre file is
  silently ignored rather than rejected, since Cost Centre genuinely
  has no such concept to reject a value against. No schema change.

## The precedent this follows

**Purchase Orders' own CSV load (decisions 0370/0373)**, structurally:
one `GET .../csv-format` a screen builds its own template from, one
`POST .../csv-load` that refuses per row rather than per file, and a
`CsvFieldSpec[]` array the parser's own column map and the format
response are both derived from — so the documentation returned to a
person can never describe a column the parser does not actually accept.
The Template button downloads a file built client-side from
`format.fields.map(f => f.columns[0])`, not a static asset. Both icons
(`load`, `download`) already exist in `icons.js` from that decision and
are reused verbatim.

**Where this decision genuinely diverges from that precedent, and
why:**

- **Full field replace per row, not PO's delete-and-reinsert.** A
  coding-list entry is a single row with no child lines underneath it
  to replace, so "the file is the source of truth for every field it
  describes" is implemented as an ordinary update rather than PO's
  delete-and-recreate.
- **Never destructive across rows — deliberately not Supplier's own
  precedent.** `load-suppliers.ts`'s existing loader upserts and
  soft-deactivates any supplier absent from a re-upload. Coding lists
  are reference/master data a person may keep editing by hand between
  loads — the operator's own words, *"manual changes this way will be
  minimal,"* not *never* — so an id absent from the file is left
  completely alone, matching Purchase Orders' own semantics instead.
- **Two-phase load, not needed by either precedent**, because this is
  the first CSV load in the app that has to resolve a same-list parent
  pointer. See below.

## The two-phase load, and why it exists

Project's own hierarchy (decision 0444) means a CSV export can list a
child entry before the parent it points at. A single top-to-bottom pass
would fail that file, or worse, silently succeed by writing a
not-yet-existing parent id and only catching the mistake on the next
run.

`handleLoadCodingListCsv` instead runs every row twice:

1. **Phase one** creates or updates each row's own fields, with its
   parent explicitly cleared to `null` regardless of what the file
   says (a genuine pre-existing parent is reinstated, if named, in
   phase two — nothing is lost, only deferred).
2. **Phase two** then sets whatever parent each row actually named,
   once every id anywhere in the file is guaranteed to already exist
   in the database. File row order is now irrelevant to whether a
   hierarchy loads correctly.

This is not a new validation path: `handleUpdateCodingListEntry`'s own
existing cycle detection (`wouldCycle()`, decision 0444) still runs in
phase two exactly as it already does for a hand-edited row, and still
catches a genuine cycle, because it reads live database state at the
moment each phase-two row executes rather than trusting anything from
the file itself.

## One route, dispatching to the handlers that already exist

`workers/vf-app/src/coding-list-csv-route.ts` (new) —
`GET /coding-lists/:type/csv-format` and
`POST /coding-lists/:type/csv-load`, gated on `Admin.Configure`, for a
`:type` set of `cost_centre | project | commodity_code | gl_code`
(Cost Centre included here even though `coding-list-route.ts`'s own
generic CRUD route does not cover it — it keeps its own table per
decision 0016/0444).

Every row is validated and written by exactly the same code a
hand-entered row already goes through — `handleCreateCostCentre` /
`handleUpdateCostCentre` for Cost Centre, `handleCreateCodingListEntry`
/ `handleUpdateCodingListEntry` for the other three — so a CSV load can
never accept something the existing form would refuse, and there is no
second copy of filter validation, parent-cycle detection, or duplicate-
id checking to keep in sync with the first.

Duplicate ids **within one file** are refused whole-file (the exact row
numbers named), rather than silently letting the last one win — the
one place this decision refuses an entire file rather than a single
row, since a file that disagrees with itself about what an id means has
no well-defined per-row outcome to report.

## The frontend

`workers/vf-ui/public/coding-lists.js` — `csvLoaderPanel(listType,
refresh)`, a `.panel` with Template/Load buttons in its own `cardhead`
(the same title-left/action-right shape every other card here already
uses), a bare file input, an outcome/error note, and a collapsed
`<details>` disclosure of the accepted columns — rendered as the first
child of each of the four applicable tabs, ahead of that tab's own list
section. Company code's tab is untouched.

`workers/vf-ui/public/ap-setup.js` — `load()` now also awaits
`loadCodingListCsvFormats()` (one fetch per applicable list type,
fired alongside the six existing fetches in the same `Promise.all`),
kept **outside** the existing `ok`-check: a CSV-format fetch failing
degrades only that tab's Template button to disabled, never the whole
screen the way the six existing fetches already do.

**A real bug found and fixed during this decision, before it ever
reached the operator:** `csvLoaderPanel`'s own outcome note originally
held a closure-captured reference to its note-box element, written to
*after* `await refresh()`. `refresh()` calls `load()` then `render()`,
and `render()` replaces the entire screen's DOM — so that closure-held
reference was silently writing to a detached node, and the load's own
outcome would never have appeared on screen. Fixed the same way
`purchase-orders.js`'s own `runLoad()` already solved the identical
problem: the note box gets an `id`, and is re-queried with
`document.getElementById()` after `refresh()` completes rather than
held across the re-render.

**Proxy allowlist — checked, not assumed, and no new entry needed.**
The existing wildcard `/^\/coding-lists\/[^/]+\/[^/]+$/` in
`workers/vf-ui/src/index.ts` (added for decision 0444's own
`PUT /coding-lists/:type/:id`) already structurally matches both new
routes — `mayProxy()` tests only the path, never the method. A comment
was added recording that this was checked directly, rather than
leaving a silent no-op next to a pattern this project has now found
missing eight separate times (0212, 0319, 0324–0328, 0371, 0415,
0417–0430, 0441, 0444).

**`.poformat` → `.csvformat`.** The collapsible format-reference
disclosure's CSS class, introduced by Purchase Orders (decision 0373),
was named after that one feature even though its rules are entirely
generic. Renamed across `app.css`, `purchase-orders.js`, and
`purchase-orders.test.ts` so the class name matches what it actually
is now that a second feature shares it — the same naming discipline
this project applied to the `PROXIED_TO_INSTANCE` gap-comment above.

## What was found, not built

- **A pre-existing test-harness bug, found and fixed as part of
  shipping this decision's own migration**: `workers/vf-licence/test/
  setup.ts`'s `toOneStatementPerLine()` splits a migration's SQL on
  every literal `;` character with no awareness of quoted string
  literals, so a UI string containing a semicolon breaks the test
  schema entirely (267 of 320 tests failed on the first run of this
  decision's own migration). Not a bug in migration 0148's SQL — the
  file replayed clean against a real SQLite engine via
  `apply_migrations.py --replay-only` throughout. Fixed here by
  rewording the one help string that contained semicolons (an em dash
  and commas, not three clauses joined by `;`), the smaller and more
  contained fix compared with making the shared splitter
  quote-aware, which no other migration in the chain has ever needed
  and which touches infrastructure all 148 migrations rely on. Left
  named here rather than fixed at the root, in case a future string
  genuinely needs a semicolon and this recurs.
- **No delete anywhere in this decision** — matches the load itself:
  an id absent from a file is left alone, never removed, and there is
  still no delete route for any of these four types (decision 0444's
  own gap, unchanged).
- **No dry-run / preview-before-load** — a load applies immediately;
  Purchase Orders' own CSV load has never had one either, so this is
  consistent with, not behind, the existing precedent.

## Tests

`workers/vf-app/test/coding-list-csv-route.test.ts` (new, 26 tests) —
format shape per type (including Cost Centre's own six-field shape,
one more than the other three's five, and "Approver"/"owner" both
accepted); structural refusals (no id/name column, duplicate id in
file, empty file); full-replace and blank-clears semantics; child-
before-parent load order; cycle detection still catching a genuine
cycle via the existing route; never-destructive-across-rows; GL Code's
own two-filter worked example end to end; and Cost Centre's two real
differences — a Default column value silently ignored, "Approver"
resolving to `owner_user_id`, and a name-disagreeing re-load refused
with the exact stored-vs-file text.

`workers/vf-ui/test-browser/coding-lists.test.ts` (extended, 11 → 20
tests) — loader panel present on all four applicable tabs and absent
from Company code; Template button disabled until the format fetch
resolves, and its downloaded content matches the format exactly; the
no-file message; a full load-then-refresh cycle (custom inline
`vi.fn()` fetch mock, since the shared `stubFetch()` helper has no
support for a dynamic per-call response and the established precedent
for that case, from `purchase-orders.test.ts`, is a custom mock rather
than extending the shared helper); refused rows displayed; a non-OK
route response displayed; a network failure displayed.

**Five pre-existing decision-0444 tests broken by this decision's own
UI change, found and fixed as part of it, not left for later:**
`csvLoaderPanel` renders as a `.panel` ahead of each tab's own list
`.panel`, and its own collapsed `<details class="csvformat">` still
contains a real `<table>` — jsdom's `querySelector` matches content
inside a closed `<details>` regardless of visibility. Five bare
`document.querySelector(".panel")` / `document.querySelector("tbody
tr")` lookups in the pre-existing Cost Centre, Project, and General
Ledger Code tests were now matching the *new* panel or its format
table instead of the list they were written to test. Fixed by scoping
each to the **last** `.panel` in the DOM (`csvLoaderPanel` always
renders first, the list section always second), not by weakening the
new feature's own markup. `ap-setup.test.ts` was checked for the same
risk and found clear — its own bare-selector tests are on the Matching
tab (no coding lists at all) or Company code (no loader panel), and
its Approval Hierarchy tests already scope by heading text.

`workers/vf-licence/migrations/0148_coding_list_csv_strings.sql` (new)
— 16 keys × 2 locales (32 rows), added to `string-coverage.test.ts`'s
own `KEYS_THE_INTERFACE_USES`.

`eslint .` clean across all three workspaces for every file this
decision touched or added. Full, unfiltered suites run in every
workspace: `vf-app` **2587/2587** (113 files — +26 over decision
0444's 2561), `vf-licence` **320/320** (21 files), `vf-ui` **74/74**
Worker (2 files) + **996/1000** browser (48 files, 20 of them in
`coding-lists.test.ts`). The four browser failures are all in
`test-browser/document-window.test.ts` — a pre-existing, unrelated
issue already documented in `docs/PROGRESS.md`, untouched by this
decision.

`python3 migrations/apply_migrations.py --replay-only` — clean for
both chains: `vf-app` 76 migrations, unchanged this decision (no new
vf-app migration), 170 standing invariants re-checked; `vf-licence`
**148 migrations** (0148 itself holds 1 assertion), 73 standing
invariants re-checked.

## Still to do, operator side

Migration `0148` is **not yet applied to any live database** — it has
only been replayed locally. Per this session's own now-three-times-
repeated finding (migrations 0075, 0146, 0076: a deploy and a migration
are two separate steps here, and skipping the second one produces a
raw-string-key UI, not an error), the operator's own next step after
deploying `vf-ui`/`vf-app` for this decision is:

```
apply_migrations.py --remote --database vf-licence-poc --migrations-dir workers/vf-licence/migrations
```
