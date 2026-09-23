# 0453 — Invoice-Line Coding Pop-Out

**Status: confirmed pushed, deployed, and migration applied.**
`origin/main` fetched directly reads `ccbbc82`, matching this session's
own commit exactly. `wrangler deploy` confirmed run for all three
workers this decision touched — `vf-app`, `vf-ui`, and `vf-licence` —
and migration `0154` (`vf-licence-poc`) confirmed separately applied,
per the operator's own report.

---

## What was asked

*"I would like to see a pop-out, that is accessible from a Coding icon
on the invoice line. the pop-out will show the Org / Company Code and
optional Cost Center or Project, then provide the linked Commodity and
General Ledger Code. Each should expose a searchable drop-down that
searches across the already created Account Coding lists in the AP
Setup screen."*

Asked immediately after decisions 0451 (Line Level Account Coding) and
0452 (Cost-Object Approval Hierarchy, Phase 2) — both of which built
the *routing* and the *storage* for these four fields but left, in
0451's own words, *"the one remaining gap between this routing now
working and an operator actually seeing more than one approval task per
line in practice"*: nothing anywhere let a person actually choose a
Project, Commodity Code, or General Ledger Code by searching Account
Coding's own lists. This decision closes that gap.

## What was found

**The write mechanism already existed and needed nothing new.**
`POST /invoices/:id/key` (`key-fields-route.ts`) accepts any of the four
fields the moment a stage's own `field_visibility` configuration marks
it `edit` — the identical mechanism the line table's own plain
`<input>` cell (`viewer.js`'s `cell()`) already uses. This decision adds
a second, friendlier way to set the same four values; it does not touch
how they are stored, validated, or saved.

**The two read routes those four fields' own lists live behind were
gated for the wrong caller.** `GET /org/cost-centres` and
`GET /coding-lists/:type` were both built for the Account Coding tab
alone (decision 0444), gated `Admin.Configure` — correct for
*configuring* the lists. The person who would open this new pop-out is
keying an invoice line, and holds `AP.Validate`, the same permission
`POST /invoices/:id/key` itself already requires — not
`Admin.Configure`. Confirmed directly by reading `index.ts`'s own route
guards rather than assumed; this would otherwise have shipped a pop-out
every ordinary AP user gets a 403 opening. Widened both routes to
accept **either** permission (`requireAnyPermission`, a new, generalized
sibling of `requirePermission` in `enforce.ts` — additive, every one of
`requirePermission`'s own 25+ existing callers untouched) rather than
forking a second, near-identical read route that would drift from the
first.

**"Linked" already had a real mechanism to reuse, not build.** Migration
0076's own `coding_list_type_filters` already declares General Ledger
Code as filtered by both Company Code and Commodity Code, and Cost
Centre by Company Code — the exact "linked" relationship asked for.
What was missing was a way to *read* a list narrowed to a chosen filter
value; `handleListCodingListEntries` and `handleListCostCentresDetailed`
could only ever return a list's full, unfiltered contents (or, via
`all=1`, everything). Neither route needed reshaping — both gained one
new, optional `filters` parameter, defaulting to `null`, changing
nothing for any existing caller.

**Company Code needed no new read at all.** `stored.buyer.entityName`
(decision 0226) is already the invoice's own resolved org-unit name,
fetched and held client-side the moment the viewer opens, for the
existing "Buyer" card. The pop-out's own Company Code row reads it
directly — zero new network calls for a field this decision only ever
needed to *display*, not edit.

**No existing per-line pop-out precedent existed to extend** — the
closest prior art, `openHeaderFieldsPopout()`, is header-level and
singular (one invoice, one pop-out, memoized and reopened). This
decision's own pop-out is per-line and rebuilt fresh each open, closer
in shape to `openSearch()` — but `openSearch()` itself always closes
the whole pop-out and calls back into `openViewer()` on a single choice,
right for changing the Seller or Buyer and wrong here, where choosing a
Cost Centre should not close a form with three more fields still open.
Its own debounce-free "only the newest answer counts" guard is reused;
its close-and-reopen choice is not.

## What was built

- **`requireAnyPermission`** (`workers/vf-app/src/enforce.ts`) — "may
  this caller do this, OR that," authenticating once and checking a
  list of permissions in order. A new function beside
  `requirePermission`, not a widened signature on it: every one of that
  function's own many callers means a single permission and stays
  exactly as it was.
- **`GET /org/cost-centres` and `GET /coding-lists/:type`, widened** to
  `Admin.Configure` **OR** `AP.Validate` (`workers/vf-app/src/
  index.ts`). Both routes' own write siblings (`POST`/`PUT`) are
  untouched — still `Admin.Configure` only, proven by a test that an
  `AP.Validate`-only caller can read but not write.
- **A `filters` parameter on `handleListCodingListEntries`
  (`coding-list-route.ts`) and `handleListCostCentresDetailed`
  (`ledger-route.ts`)** — one `EXISTS` clause per applied, *declared*
  filter against `coding_list_entry_filters`, combining with the
  existing `search` clause. A filter key a list type does not declare
  is silently ignored on this read path (a write still 400s on the
  same case via the existing `validateFilters` — reads degrade, writes
  refuse, the same split `handleListCodingListEntries`'s own `all`
  bypass already draws). `filter.<type>=<id>` query params, parsed once
  (`filtersFromQuery` in `index.ts`) and passed through to both routes.
- **The Coding icon**, on every invoice line, always shown regardless
  of `canEditAnything` — the same reasoning `headerSummary()`'s own
  "Header Fields" action already carries: looking up a line's own
  coding is not an edit. A new `coding` glyph in `icons.js` (a tag,
  checked off), and the line table's own trailing column widened from
  one button to two.
- **`openLineCodingPopout`** (`viewer.js`) — the pop-out itself.
  Company Code read-only from `stored.buyer.entityName`; Cost Centre,
  Project, Commodity Code, and General Ledger Code each a new
  `searchableEntryPicker` — search-as-you-type against
  `fetchCodingEntries`, which normalises Cost Centre's own richer
  `{costCentres: [...]}` shape and the other three's shared
  `{entries: [...]}` shape to one `{id, name}[]` a picker never has to
  tell apart. General Ledger Code's own picker reads Company Code
  (always, from the invoice) and Commodity Code (once chosen) live at
  fetch time, so choosing a Commodity Code narrows the General Ledger
  Code list on the very next keystroke, with no re-render needed.
  A field not configured `edit` at the invoice's current stage renders
  read-only here too — this pop-out has no route of its own into a
  field's own visibility, only into its value; a field entirely hidden
  (the still-current default per decisions 0451/0452) additionally
  says so.
- **Additive, not a replacement, for the line table's own plain
  `<input>` cell** — a deliberate call, not an oversight. Both read and
  write the identical `line[spec.field]`, so either entry point works
  today and neither can drift from the other; this pop-out has no save
  action of its own; the page's existing Save button persists whatever
  either entry point set, exactly as it always has.

## What was not built

- **No enforcement that a keyed value actually exists in the chosen
  list.** This pop-out makes picking a real, searched value the easy
  path; it does not remove the plain-text cell decision 0451 already
  left free-text, and this decision does not close that gap either —
  named there, restated here, still open.
- **No UI to flip a field's own visibility from hidden to `edit`.**
  Still the same gap named while answering *"Is there a UI at the
  Coding stage that is accessible"* earlier this segment: this pop-out
  is a consumer of `field_visibility`, never a writer of it. A customer
  configures these four fields editable at whichever stage they choose,
  the same as they already do for BT-133 alone today, and the pop-out
  then does something at that stage; until then, every row it shows is
  read-only.
- **No Coding stage, no `AP.Code` wiring.** Named as 0451's own
  separate, still-open scope; unchanged here.

## Verification

`workers/vf-app`: `test/enforce.test.ts` (18/18 — 5 new, proving
`requireAnyPermission` directly: 401, 403 with neither permission held,
authorized holding either one alone, authorized holding both),
`test/coding-list-route.test.ts` (five new tests under "filters param
— narrowing a read to matching entries only," covering a single
filter, combined with search, two filters stacked, an undeclared
filter key silently ignored, and an entry with no filter value not
matching a filtered read), `test/accounting-frame.test.ts` (three new,
the same shape restated for Cost Centre's own dedicated table/query),
`test/index.test.ts` (ten new, through the real router: 401/403/200 for
both routes under both permissions, the write side's own `Admin.
Configure`-only gate confirmed unchanged, and `filter.company_code=`
narrowing a real `GET /coding-lists/gl_code` response end to end) — run
together with `test/cost-centre-route.test.ts`, `test/coding-list-csv-
route.test.ts`, `test/key-fields.test.ts`, and `test/field-visibility.
test.ts` (the two files nearest the mechanism this pop-out reads and
writes, unchanged by this decision, run to confirm nothing regressed),
**342/342** across all eight files in one run. `workers/vf-app`'s own
full-repo suite again could not complete inside this session's own
tool timeout (decisions 0448/0449/0451's own already-documented
limitation); every file plausibly touching what changed was run
directly instead, as above.

`workers/vf-licence`: full suite **320/320** (unchanged in count —
migration `0154` adds rows to the existing `ui_strings` table, not a
new test file), including `string-coverage.test.ts` **10/10** with the
seven new keys added to `KEYS_THE_INTERFACE_USES`, confirmed by one
unfiltered whole-suite run (21 files).

`workers/vf-ui`: Worker suite **74/74** (unchanged — no proxy or route
file touched), browser suite **1048/1048** (1040 + 8 new, in a new
"the invoice-line Coding pop-out" describe block in `viewer.test.ts`
— the icon shown regardless of edit permission; Company Code shown
read-only; an already-keyed Cost Centre resolved to its own name;
a field with no stage configuration at all shown read-only with a
note; a field configured `read` shown read-only with no such note;
searching Project and reaching the page's own Save payload; clearing a
chosen value removing it from that same payload; and General Ledger
Code's own picker proven linked — filtered by Company Code from the
first keystroke, and by Commodity Code only once one is chosen),
confirmed by an unfiltered whole-suite run (48 files); the pre-existing
`document-window.test.ts` unhandled-rejection flake is present at its
identical, already-documented baseline count (160 non-fatal errors),
unrelated to this decision. `npx tsc --noEmit` across the monorepo
surfaces only pre-existing, unrelated failures (`cloudflare:test`
module resolution outside vitest's own workerd runner, and type
mismatches in `workload*.test.ts` predating this decision) — none in
any file this decision touched.

## Still to do, operator side

Push, deploy `vf-app`, `vf-ui`, **and** `vf-licence` (all three changed
this decision — `vf-app` for the two widened routes and the new
`filters` support, `vf-ui` for the pop-out itself, `vf-licence` for
migration `0154`'s own new strings), and apply migration `0154` to
`vf-licence-poc`, then confirm each independently, per this project's
own established rule that push, deploy, and migration-apply are never
implied by one another.
