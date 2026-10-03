# 0618: Fraud Prevention, a row of tiles and a short list per check, with drill-down

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0261`** (strings). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 3 October 2026, on AP Analytics' Fraud Prevention tab: *"The report
cards are narrow and grow very long down the page. Is there a way to
improve the visuals and also allow drill-down in these cards? can you
advise?"*

## Why they were long

All five checks were tables in tiles about 290px wide (`card-graphic`).
Four of them (duplicates, unapproved suppliers, statistical outliers,
segregation of duties) listed **every** invoice flagged, with no limit;
exception trends stacked **three** tables (by supplier, user and type),
up to 22 rows each with a line. Nothing could be clicked.

Asked to choose between summary tiles with lists, full-width lists
only, or trimming the tiles, Dan chose **summary tiles with lists**.

## What was decided

### A row of tiles

At the top, one tile per check, side by side: its count (in the warning
colour where it is not 0) and its name; exception trends also shows its
eight weeks as a line. **A tile takes you down to its list.** A check that
failed to load has no tile; its error card stands where its list would.

### Each check full width, its first five

Below, each check is a **full-width card** (`card-list`) with its count
beside the title and **its first five**, the most urgent first as each
route already orders them, and **Show all N** where there are more:

| Check | Show all opens Documents at |
|---|---|
| Potential duplicates | Documents' own duplicates list (`duplicates=1`, the same `POSSIBLE_DUPLICATE_THRESHOLD`, 0463) |
| Unapproved-supplier invoices, Statistical outliers, Segregation of duties | exactly the invoices the check listed (`ids`), the banner naming the check: *Showing the invoices in Statistical outliers* |

**A row opens its invoice** in the viewer, read-only (no task, so no
actions, as from Documents, 0164); closing it returns to Fraud
Prevention as it was. Rows open from the keyboard too.

### Exception trends: tabs, and rows that open Documents

One full-width card, with **By supplier / By user / By type** as tabs, one
table showing. A row opens Documents at the invoices behind it: a stage
visit that **failed validation in these eight weeks** (as the card counts,
`fraud-exception-trends-route.ts`) from that supplier (or with none
matched), with a task on it completed by that person, or naming that
check among its failures. *Showing failed validations for Lager Nord
GmbH in the last 8 weeks.*

- `GET /api/documents` gains **`ids`** (at most 500) and
  **`exceptionsSince`** with **`exceptionSupplierId`** (`~none` for
  unmatched), **`exceptionUser`** or **`exceptionType`**. A type matches
  whole (a check named `amount` does not match `amount_mismatch`).
  Someone else's `exceptionUser` needs **AP.FraudReview**, as the card.
- `GET /api/fraud/exception-trends` adds **`weeklyTotals`** and
  **`total`**, every failed validation, for the tile (the breakdowns are
  capped at their top 8, 8 and 6, so cannot be summed for it).
- Shared pieces are in `fraud-list.js`; each check's module gains
  `summary()` for its tile.

## Not built

- A row's supplier opening that supplier: the Suppliers screen has no
  way to open one supplier yet, and unapproved suppliers' route does not
  return a supplier id.
- *Show all* for a check of more than 500 invoices sends the first 500.

## Verification

- **`vf-app`** `fraud-exception-trends.test.ts`, 3 new tests, seeded
  once and asked of both the card's route and Documents: weekly totals
  for the tile; Documents finding the same invoices by supplier,
  unmatched supplier, person and type, and a partial type matching
  nothing; `ids`. `documents-analytics-filters.test.ts`: someone else's
  `exceptionUser` refused without AP.FraudReview. 5 fail against the
  routes before this change. Full run 3467, of which 3465 pass (the two
  known failures).
- **`vf-ui`** browser: `fraud-list.test.ts`, new, 8 tests: first five of
  seven with the count and *Show all 7*, full width; no *Show all* at
  five; duplicates' *Show all* asks for `duplicates=1`; outliers' asks
  for exactly its `ids` and names the check in the banner; segregation
  of duties sends each invoice once; a module's tile count; a row (by
  keyboard) opens the viewer for its invoice with the screen set aside;
  tiles with their counts, flags and line, and a tile scrolling to its
  list. `fraud-exception-trends.test.ts` rewritten for tabs, and rows
  asking Documents for supplier, unmatched, person and type.
  `ap-analytics.test.ts`: the tab's order and its tiles. 14 fail against
  the interface before this change. Full run 1491, of which 1490 pass
  (the known `typography.test.ts` 10px gap); worker 111 of 111. The 331
  unhandled errors the browser run reports are the same 331 before this
  change (viewer, documents, tasks and others).
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 261.
