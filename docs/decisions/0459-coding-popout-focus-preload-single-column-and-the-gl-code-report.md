# 0459 — Auto-Focus, Pre-Load, One Column Again, and What "No Rows for General Ledger" Actually Was

**Status: built.** Not yet confirmed pushed and deployed, and migration
`0157` not yet confirmed separately applied — awaiting the operator's
own report.

---

## What was asked

Live, once decision 0458 shipped: *"Looks better. Could we auto-focus
on the Cost Center and pre-load the screen with values for that field.
I would prefer 1 listed set of results rather than scrolling the
results across two panels. Introduce a scroll bar, if the results
exceeds the screen height. Also - I see no rows returned for General
Ledger, even though it seems to be populated."*

Five things, taken in turn below.

## Auto-focus and pre-load Cost Centre

`searchableEntryPicker` gained two new options. `preload`, passed only
for the Cost Centre field (always the first of the four, and the only
one this was asked for), runs the exact same search a person typing an
empty box would get — the server already treats a blank `search` as
"no search clause," so this is genuinely the list's own first page,
not a second code path invented to match it. It runs once, the moment
the pop-out is built, regardless of whether the field already has a
value on the line; a person changing an already-coded Cost Centre gets
the same head start as one coding it for the first time.

Auto-focus is not a picker option at all — `openLineCodingPopout` now
keeps a handle to the Cost Centre field's own `<input>` (found via
`.querySelector(".searchbox")` on the element `searchableEntryPicker`
returns) and calls `.focus()` on it once, right after
`document.body.append(backdrop)`. Focusing has to happen after the
pop-out is actually in the document — a detached element cannot take
real focus — which is why this isn't done inside the picker itself,
built before the backdrop exists.

## One column again

Decision 0458's own two-column grid is reverted to a single column —
reported live as harder to follow than scrolling straight down one
list. `.codingresultslist` is now a `flex-direction: column` list
rather than a `grid-template-columns: 1fr 1fr` grid; the now-redundant
`@media (max-width: 620px)` override that used to collapse two columns
into one on narrow screens is removed along with it, since one column
is now the only column. Row markup (`.searchresult`, `.resultname`,
`.resultid`) is unchanged — this is a layout change only.

## The scrollbar

Already there — `.codingresultslist { overflow-y: auto; flex: 1;
min-height: 0; }` was written for decision 0458 and needs no change to
keep doing its job. Worth restating why it's more likely to be
*needed* now: one column holds roughly half as many rows per screen
height as two did, so a search that used to fit without scrolling may
not any more. Confirmed by inspection, not by a new test — jsdom does
not lay out CSS grids or flex boxes, so no test in this suite has ever
verified the two-column arrangement pixel-for-pixel either; both
decisions rely on the same DOM-structure-plus-CSS-review verification
0458 already used.

## General Ledger Code's own zero rows

**Traced to intended behaviour, not a bug.** `coding-list-route.ts`'s
own `codingListFilterClause` requires an `EXISTS` match against
`coding_list_entry_filters` for every filter a caller supplies; an
entry with *no* filter row at all for that filter type — never scoped
to any Company Code, say — fails that `EXISTS` the same as an entry
scoped to a *different* value would. `coding-list-route.test.ts` has
had a dedicated, passing test for exactly this since decision 0453:
*"an entry with no filter value set at all does not match a filtered
read."* And this codebase already has a named decision for the
general principle — 0355, "A Missing Filter Is Not 'Show
Everything'" — reached the same way, from a different live report,
over General Ledger Code's own sibling problem (an *unfiltered*
request must never fall back to returning every row). The two are the
same discipline read from opposite ends: absent means nothing, never
everything, whether the absence is in the request or in the entry.

So General Ledger Code returning zero rows, live, almost certainly
means its entries have not yet been given Company Code and/or
Commodity Code filter values under AP Setup → Account Coding — not
that anything is broken. **This needs the operator to check, not
something this session can confirm from here**: this session has no
access to the live `vf-licence-poc`/`vf-app-poc` databases, only the
code and its own test data.

**What was actually missing, and is now fixed**: the pop-out's own
silence about *why*. A scoped field's empty result used to look
identical to an unscoped field that genuinely has no matches — both
just read "Nothing on file matches that." `searchableEntryPicker` now
takes a `scopeNote` — a closure, the same "read live, not captured
once" reasoning `filters()` itself already uses, since which of a
field's own declared filters is actually active changes as a person
fills in the pop-out's other fields — returning the display labels of
whichever declared filters are currently set. An empty result with at
least one active filter now shows a second line: "Narrowed by:
Org / Company Code" (only Company Code, until a Commodity Code is
also chosen; both once it is). One new string,
`viewer.coding.nomatchesscoped` (migration `0157`) — the field labels
themselves are the same `apsetup.codingtab.companycode`/
`.commoditycode` keys AP Setup's own Account Coding tab already uses,
not translated a second time.

## What was not built

- **No change to `codingListFilterClause` or the "absent means
  nothing" rule itself.** Falling back to "show everything" for an
  unscoped entry would just move the same silent-surprise problem
  somewhere else — a General Ledger Code search scoped to the wrong
  company would start returning entries that belong to a different
  one. The gap was the silence, not the rule, so only the silence was
  fixed.
- **No screen to bulk-edit General Ledger Code's own filter values
  from here.** If the operator confirms this diagnosis and the fix is
  "go fill in Company Code / Commodity Code for these entries," that's
  either AP Setup's existing per-entry edit form or a CSV re-load with
  the `Filter by - Company code` / `Filter by - Commodity Code`
  columns filled in (`coding-list-csv-route.ts`, decision 0445) —
  both already exist; nothing new needed unless the operator finds
  neither workable at the actual data's scale.

## Verification

`workers/vf-ui`: the pre-existing decision-0453/0457/0458 "invoice-line
Coding pop-out" describe blocks (16 tests) re-run first — all still
pass unmodified. Five new tests added in a new "auto-focus, pre-load,
and naming what narrowed an empty result" describe block: the Cost
Centre box holds real focus (`document.activeElement`) the instant the
pop-out opens; its own first page of results shows with nothing typed;
no other field is preloaded (checked directly — no request to
`/api/coding-lists/project` fires on open); a plain empty result with
no active filter still reads exactly "Nothing on file matches that.",
nothing appended; and General Ledger Code's own empty, Company-Code-
scoped result reads both lines, the note naming "Org / Company Code."
Full whole-repo browser suite run unfiltered afterward — **1061/1061
across 48 files** (1056 + 5 new); the pre-existing `document-window.
test.ts` unhandled-rejection flake is present at its identical
baseline count (160 non-fatal errors, none a failing assertion),
reconfirmed via a direct `git stash` comparison of this file in
isolation (145 of the same errors reproduce with or without this
decision's own changes, all from unrelated describe blocks in the same
file).

`workers/vf-licence`: new migration `0157_coding_nomatches_scoped_
string.sql` (one key, `viewer.coding.nomatchesscoped`, en/de) —
`apply_migrations.py --replay-only` clean, **157 migrations, all
assertions held**. `test/setup.ts` wired up for the new migration in
the same call this decision made anyway, following the now-standing
habit this file's own gap (found during decision 0457) established.
Full whole-repo suite run unfiltered — **320/320 passing across 21
files** (unchanged in count — this migration only adds rows to the
existing `ui_strings` table).

No `vf-app` change at all — this decision is `vf-ui`/`vf-licence`
only; the General Ledger Code finding is about how existing, unchanged
server logic and unchanged live data interact, not a code defect to
fix in `coding-list-route.ts`. `npx tsc --noEmit`: the same repo-wide,
pre-existing 753-line baseline as every prior decision this session —
unsurprising, since this decision touches only plain `.js`/`.css`
files, no TypeScript.

## Still to do, operator side

`wrangler deploy` for `vf-ui`, and migration `0157` applied to
`vf-licence-poc` via `apply_migrations.py --remote`, same as every
prior decision in this table.

**And a real question only the operator can answer**: do General
Ledger Code's own entries in AP Setup → Account Coding actually have
Company Code (and, where relevant, Commodity Code) values set under
their own "Filter by" columns? If not, that's the fix for the original
report — filling those in, not a code change. If they *do* have those
values set and the pop-out still returns nothing once this deploys,
that would mean the diagnosis above is wrong and there's a second,
real bug still to find — worth reporting back explicitly either way.
