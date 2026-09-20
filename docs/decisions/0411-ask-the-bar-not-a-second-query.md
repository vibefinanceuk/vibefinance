# 0411 — Ask the bar, not a second query

**Status: built.**

---

## What was asked

Reported live, verbatim: *"please can you update the exceptions by
supplier, and Task Aging Report in the Dashboard, so that they link to
theDocument screen with items shortlisted?"*

Both cards already counted something specific — `exceptionsBySupplier()`
groups failed-validation invoices by supplier over the last 30 days;
`ageing()` buckets open tasks by age — but neither had a click. Every
other card with real rows behind it already drilled through to the
Documents screen (`where_things_are` by stage, `unplaced_documents`/
`possible_duplicates`/`done` by alert), so this was extending an
established pattern to the two cards that hadn't gotten it yet, not
inventing a new one. No question was put to the operator before
starting: `donutChart`'s own `onSelect` precedent for `where_things_are`
answered every design choice a clarifying question would have raised.

---

## What was built

**Exceptions by Supplier.** Each bar in the `barList` — and, in the
single-supplier case, the whole tile — now opens Documents filtered to
that supplier's own name. The name is also the exact expression
`exceptionsBySupplier()` groups by
(`COALESCE(sup.name, json_extract(h.facts_json,'$."BT-27"'), 'Unknown')`),
so `documents-route.ts` was given the same expression, the same 30-day
window, and the same `stage_visits.validation_passed = 0` condition —
not a second, separately-maintained definition of "an exception."
Zero-count suppliers were never sent (there are none to click), and an
empty-suppliers card gets no click at all, per decision 0161.

**Task Aging Report.** Each bar now opens Documents filtered to that
bucket's own day range. `ageing()` (`dashboard-route.ts`) is the one
place the five boundaries — `<1d`, `1–3d`, `4–7d`, `8–30d`, `30d+` — are
decided; its response now carries `minDays`/`maxDays` alongside each
bucket's `label` and `n`, and that pair travels unchanged through the
click handler and the `/api/documents` request to a matching `EXISTS`
clause against `tasks`/`stage_visits`, rather than `documents-route.ts`
or `dashboard.js` hardcoding the same five numbers again. `maxDays:
null` is the open top of the last bucket. Zero-count buckets are not
clickable.

**The click target itself.** Neither `barChart` nor `barList` had a
click before this. `donutChart`'s own doc comment — *"the legend is the
click target, not the arc"* (decision 0264) — exists because a thin SVG
stroke is a poor click target; that reasoning doesn't hold for a bar,
which is a wide rectangle (up to 54px). So the bar itself is the
target: `barChart` now wraps each bar's rect and text in an `<g
class="bargroup clickable">` with `.onclick` set directly (`el()` is
SVG-only and attribute-based, so a function prop has to be assigned
after the node exists, not passed into `attrs`); `barList` adds
`.clickable` and `.onclick` to each row div the same way `stageFilter`'s
own rows already worked.

**Documents screen.** `supplierFilter`/`agingFilter` follow
`stageFilter`'s own shape exactly — set by `openDocumentsForSupplier
Exceptions()`/`openDocumentsAged()`, read by `load()` into the request,
cleared together by the existing "Clear filter" button. The banner's
inline ternary (decision 0259/0264) grew a third and fourth branch
past the point it stayed readable that way, so it's now a small
`bannerText()` function instead — same strings, same fallback order,
just named. Two new `ui_strings` keys, `documents.showing
.exceptionsupplier` and `documents.showing.aging`, in `en` and `de`
(migration `0126`).

---

## Also fixed, same commit: `duplicates=1`'s own stale-key bug

While joining `suppliers` into `documents-route.ts`'s query for the
exceptions filter above, found that the pre-existing `duplicates=1`
click-through (decision 0259, for the "Possible Duplicates" dashboard
card) had the exact same mistake decision 0410 already found and fixed
on that card's own count: it matched `json_extract(h.facts_json,
'$."invoice.duplicate_confidence"')`, a key `handleUpsertInvoice()`
(`invoice-facts-route.ts`) never actually writes into stored
`facts_json` — that key only ever exists in memory, synthesised at
read time by a different route. 0410 fixed the dashboard tile's own
count to read the real `duplicate_confidence` column instead, but
never touched this route, so the click-through stayed broken after
that fix landed: the tile counted correctly again, but clicking it
through to Documents kept showing nothing. The existing test for this
filter, `seedDuplicate()`, had itself been `json_set`-ing that same
never-written key directly into the database to make the test pass —
bypassing the real write path entirely, and never able to have caught
this. Put to the operator directly rather than folded in unannounced;
they chose to fix it here, in the same file, same commit.

**What was built.** `documents-route.ts`'s `duplicates=1` clause now
reads `h.duplicate_confidence >= 0.5` directly, the same column 0410
already pointed the dashboard tile's own count at.
`documents.test.ts`'s `seedDuplicate()` now writes that column
directly rather than `json_set`-ing the stale key, so the test is
finally exercising a shape of data the real write path can actually
produce. Fail-first verified by stashing `documents-route.ts` alone:
both of its existing tests failed correctly against the unfixed query
(now that the test itself seeds the real column), then passed once
restored. Full vf-app suite unchanged at **1970/1970** — this fixed
two existing tests' own fixtures rather than adding new ones.

---

## Tests

`workers/vf-app/test/dashboard.test.ts` — one new test on `ageing()`,
asserting each bucket's `minDays`/`maxDays`. Fail-first verified.

`workers/vf-app/test/documents.test.ts` — 15 new tests across two
`describe` blocks: supplier-name matching (including the `BT-27`
fallback and the 30-day/failed-validation condition), unit-scope
consistency with the dashboard's own `scopeFor()`, each of the five
aging buckets' boundaries (inclusive/exclusive edges), the open-ended
top bucket, and a completed task correctly excluded. Fail-first
verified. Combined with `dashboard.test.ts`: **112/112**. Full vf-app
suite: **1970/1970**.

`workers/vf-ui/test-browser/dashboard.test.ts` — 5 new tests: a
supplier's bar and, separately, the single-supplier tile, both
resolving to `exceptionSupplier=<name>` on the outgoing request and the
name in the banner; no click at all when there are no suppliers; an
aging bucket's bar resolving to its `minDays`/`maxDays` on the request;
no click on a zero-count bucket. The aging click is dispatched via
`dispatchEvent(new Event("click"))` against the SVG `<g>` — this
project's other click tests all use `.click()` on plain `HTMLElement`s,
so this was the one part of the build without a direct precedent, and
it was run and confirmed working before anything else here was treated
as done. Fail-first verified by stashing `dashboard.js`/`charts.js`/
`app.css` together: all 3 source-dependent tests failed correctly (two
on "no clickable element found," one on `dispatchEvent` against
`undefined`), then passed once restored. Full vf-ui suite: **74/74
Worker, 721/721 browser** (716 + 5 new) — the same pre-existing
162-error batch of unhandled promise rejections in `document-
window.test.ts` (unrelated, present before this change) is unchanged.

`workers/vf-licence/test/string-coverage.test.ts` — the two new keys
added to `KEYS_THE_INTERFACE_USES`. Full suite: **320/320**.

`eslint` clean on every changed file. `scripts/check-citations.py`
clean once this record exists.

---

## What is not built

**No change to how a supplier is matched when its stored `sup.name` and
its `BT-27` disagree** — the `COALESCE` here is the same one
`exceptionsBySupplier()` already uses; resolving that disagreement, if
it matters, is a separate question from wiring the click through.
