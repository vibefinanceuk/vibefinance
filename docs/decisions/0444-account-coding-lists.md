# 0444 — Account Coding: Company code, Cost Centre, Project, Commodity Code, and General Ledger Code

**Status: built, tested. Not yet pushed or deployed** — this session
still has no push access to `vibefinanceuk/vibefinance`; delivered as a
git bundle for the operator's own pull/push/deploy sequence, the same
path decisions 0391, 0415–0443 already used.

---

## What was asked

Investigating Cost-Object approval mode (decision 0439's own resolver,
already wired, but with zero UI to manage a cost centre's own parent,
owner, or approval limit) led to a much broader ask: *"Cost-Center
Lists should be maintained under the Account Coding tab, with other
valid coding lists. This would include Company code (Org), Cost-Center;
Project, Commodity Code, General Ledger Code for example. I can provide
example lists for each of these."*

Five example CSV exports followed. Scope was confirmed directly before
any schema was written:

- **Manageable lists only** for Project, Commodity Code, and General
  Ledger Code — the same precedent decision 0031 already set for Cost
  Centre, and decisions 0023/0024 set for intake channels: nothing here
  is wired into rule validation, invoice-line capture, or BT-code
  mapping.
- **One generic framework, not five bespoke tables** — all five example
  exports shared the exact same shape.
- **Real parent pointers**, not the source export's own dot-notation-
  only convention, for Project's hierarchy.

## What the five example exports actually said

Every export shared one column set: `ID, Path, Default, Approver,
Parent List ID, Parent Entry ID`. Two carried dynamic `Filter by - X`
columns on top of that:

| List | Rows | Notable shape |
|---|---|---|
| Company code | 1 (`UK01`, Acme UK) | Already fully represented by `org_units` |
| Cost Centre | 4, flat | `Filter by - companycode = UK01` on every row |
| Project | ~90, four levels deep | `DE01MJO`, `DE01MJO.10`, `DE01MJO.10.10` — hierarchy only in the dot-separated ID and slash-separated Path; **Parent Entry ID was blank throughout** |
| Commodity Code | 46, flat | UNSPSC-shaped 8-digit segment-level codes (`10000000` = *Live Plant & Animal Material*, etc.) |
| General Ledger Code | 56, flat | `Filter by - companycode = UK01` **and** `Filter by - commoditycode = <a real Commodity Code ID>` on every row — e.g. GL `800100` "Plant Suppliers" scoped to commodity `10000000` |

The GL Code → Commodity Code filter values matched real Commodity Code
IDs exactly, confirmed by cross-referencing the two exports directly —
not a coincidence, a real cross-list dependency.

## Grounding in SAP and Oracle practice

Asked directly to bring that intelligence into the design, checked
against both before finishing rather than after:

**SAP FI-CO.** *Buchungskreis* (Company code) and *Kostenstelle* (Cost
Centre) are exactly the terms this schema already uses in its own
German strings. A cost centre belongs to exactly one *Kostenrechnungs-
kreis* (Controlling Area) — this codebase's own `ledgers` table,
decision 0194's own explicit mapping — but can serve **multiple**
company codes that share that controlling area (cross-company cost
accounting). This decision's own "Filter by company code" is
deliberately narrower than that: one value per cost centre, matching
what the operator's own export actually contained, not SAP's full
many-to-many. Named here rather than silently assumed, the same way
decision 0031 named cost centre vs. org_units as two genuinely
different concepts rather than merging them: a later decision could
widen `coding_list_entry_filters` to allow more than one row per
`(owner, filter type)` pair if a real customer need for shared cost
centres across company codes ever shows up. Project's own hierarchy
(`DE01MJO.10.10`, four levels) is structurally SAP's own **WBS element**
(*PSP-Element*) numbering under Project Systems — confirming "real
parent pointers" was the right call over the source export's own
string-only convention. A General Ledger Code carrying a stored
default Commodity Code is the same *shape* as SAP's own automatic
account determination (OBYC: material group → G/L account at posting)
— stored here as reference data only, per the confirmed "manageable
lists only" scope, and a natural foundation for a later decision that
actually derives a suggested GL code from a commodity code during
invoice coding, not built now.

**Oracle.** Oracle's own **Accounting Flexfield** — E-Business Suite and
Fusion both — builds a chart of accounts from configurable *segments*,
commonly Company, Cost Center, Account, and Product/Project. That is
close to a one-to-one match for the five lists the operator named,
which is the strongest evidence available that treating them as one
uniform, extensible *set* of coding lists (`coding_list_types` plus
generic `coding_list_entries`), rather than five unrelated tables,
mirrors how a real ERP already models this. Oracle's own per-segment
**default value** is `is_default`. Oracle's own **Cross-Validation
Rules** — which combinations of segment values are allowed together —
are the closest Oracle analog to `coding_list_type_filters` /
`coding_list_entry_filters`, with the same scope difference as SAP's
OBYC above: Oracle enforces its rules at posting time, this decision's
own version is descriptive data only.

The Commodity Code list's own 8-digit, segment-shaped codes
(`10000000`, `11000000`, …) are **UNSPSC** (United Nations Standard
Products and Services Code) — a cross-industry classification common
in mid-market procurement and spend-management tools (Coupa, Ariba,
Jaggaer all default to it), rather than a customer-specific scheme.
Nothing in this decision parses UNSPSC's own segment/family/class/
commodity structure specially — it is stored as an opaque code, the
same "manageable list, not enforced" treatment as everything else here
— but it explains the exact numeric pattern in the operator's own
export.

## The schema — one generic framework, three tables plus a type registry

`migrations/0076_account_coding_lists.sql` (vf-app):

- **`coding_list_types`** — all five lists registered as metadata
  (`id`, `name`), even though only three of them own rows in the
  tables below.
- **`coding_list_type_filters`** — which other list(s) scope a given
  list's own entries, the generalisation of every "Filter by - X"
  column: `(cost_centre, company_code)`, `(gl_code, company_code)`,
  `(gl_code, commodity_code)`.
- **`coding_list_entries`** — the three genuinely greenfield lists'
  own entries: Project, Commodity Code, General Ledger Code. A real,
  same-list `parent_entry_id`, not the source export's dot-notation.
- **`coding_list_entry_filters`** — the per-entry filter values, one
  row per `(owner, declared filter)`.

**Company code stays fully represented by `org_units`** — not
duplicated into `coding_list_entries`, shown read-only in the new tab.
**Cost Centre keeps its own existing table** (`cost_centres`, decision
0031/0195) completely unchanged in shape — 0016's own header comment
is explicit that a cost centre is deliberately *not* foreign-keyed to
`org_units`, and adding a rigid `org_unit_id` column here would have
broken that. Its own "Filter by company code" is instead stored the
same generic way GL Code's filters are, under `owner_list_type_id =
'cost_centre'` in `coding_list_entry_filters` — reusing the framework
without touching the existing table, existing routes, or the already-
deployed Cost-Object resolver (`approval-hierarchy.ts`) that reads it.

## The backend

`workers/vf-app/src/coding-list-route.ts` (new) — generic CRUD for
Project, Commodity Code, and General Ledger Code:
`GET/POST /coding-lists/:type`, `PUT /coding-lists/:type/:id`. Exports
`resolveFilterEntryName`, `filterEntryExists`, `declaredFiltersFor`,
`validateFilters`, and `replaceFilters` — the per-type filter-value
resolution, validation (only a type's own *declared* filters are
accepted, the same closed-vocabulary discipline
`handleUpdateApprovalConfig` already applies to `mode`), and
replace-not-merge write, all reused rather than duplicated by:

`workers/vf-app/src/ledger-route.ts` (extended) —
`handleUpdateCostCentre` now accepts an optional `filters` object
(currently only `company_code`), and a new `handleListCostCentresDetailed`
gives the new screen everything it needs in one call: ledger, parent,
owner, approval limit, and resolved filter names. `/org/overview`'s own
lightweight `costCentres` (`{id, name}`, used by several other pickers
already) is untouched — this is a separate, richer `GET /org/cost-centres`.

**Parent cycles are refused, not just self-parenting** — `wouldCycle()`
walks the would-be parent chain the same way `resolveApprovalChain`
already walks a cost centre's own chain, refusing any parent whose
own ancestry loops back to the entry being edited, not only the
immediate self-parent case decision 0195's own `handleUpdateCostCentre`
already catches for cost centres.

**Deliberately no delete anywhere in this decision** — the same
precedent Cost Centre's own existing routes already set (create and
edit only). Noted as a known gap rather than built speculatively.

## The frontend

`workers/vf-ui/public/coding-lists.js` (new) — the Account Coding
tab's real content, replacing its placeholder card. Five sub-tabs,
reusing `access.js`'s own established shapes rather than inventing new
ones: a `section()`-style table with a header action (`unitRow`'s own
indent-by-depth pattern, generalised to `entryDepth()` for any parent
key), and `openUnitForm()`'s own backdrop-popout create/edit shape.
Company code renders read-only (a link back to Access → Org Units,
not a second place to manage the same data). Cost Centre's create form
stays minimal (id + name, matching `handleCreateCostCentre`'s own
existing shape unchanged) with a separate edit form for parent/
approver/limit/company-code filter. Project, Commodity Code, and
General Ledger Code share one form, driven entirely by the server's own
`declaredFilters` — a GL Code entry gets Company code *and* Commodity
Code pickers, a Project entry gets neither, without three near-
identical forms.

`workers/vf-ui/public/ap-setup.js` — `load()` extended to fetch the
five pieces of data the tab needs alongside the existing two, in the
same `Promise.all`; the `coding` tab's `placeholderCard()` replaced
with `accountCodingTab(...)`.

**The proxy allowlist gap, again** — `workers/vf-ui/src/index.ts`.
Checked directly rather than assumed, the exact class of bug decisions
0212, 0319, 0324–0328, 0415, 0417–0430, and 0441 already found
repeatedly in this same file: `/org/cost-centres` (POST, decision
0031) and `/cost-centres/:id` (PUT, decision 0195) were both real in
`vf-app` and had **never** been added here — no existing wildcard
matches either. Added alongside the new `/coding-lists/:type` routes
this decision needs, so this decision does not add an eighteenth
instance of the same already-known gap on top of the seventeenth.

## What was found, not built

- **Cost Centre's own ledger assignment has no UI anywhere** — no
  ledger management screen exists at all yet (`GET /ledgers` has never
  been proxied to `vf-ui` either, confirmed directly). A cost centre's
  parent still works correctly with no ledger set, since
  `handleUpdateCostCentre`'s own same-ledger check passes when both
  sides are `NULL` — but assigning a *different* ledger to a cost
  centre, or building the ledger screen itself, is unbuilt and out of
  this decision's scope.
- **The apsetup.\* string coverage gap** — `string-coverage.test.ts`'s
  own hand-maintained `KEYS_THE_INTERFACE_USES` list has never included
  any `apsetup.*` key, across decisions 0440, 0442, and 0443 as well as
  this one. Only this decision's own 22 new keys were added; the
  pre-existing gap for the earlier three decisions' strings was found
  and named, not backfilled, to keep this decision's diff to what it
  actually changed.
- **Cross-company cost-centre sharing** (SAP's own many-to-many) — see
  "Grounding," above.
- **Deriving a GL code from a commodity code automatically** during
  invoice coding (SAP's own OBYC shape) — the data this would need now
  exists; the derivation itself does not.

## Tests

`workers/vf-app/test/coding-list-route.test.ts` (new, 21 tests) — the
generic CRUD: unknown-type 404s, duplicate-id 409s (and confirms the
same id may exist in two different list types, since they are not one
namespace), parent/approver/filter validation and 404/409 cases, real
hierarchy building (the operator's own Project example), and the
operator's own GL Code example end to end (scoped to a real company
code and commodity code, filter names resolved).

`workers/vf-app/test/accounting-frame.test.ts` (extended, +6 tests) —
`handleListCostCentresDetailed`'s own resolved names, and Cost Centre's
new company-code filter support end to end, reusing the operator's own
`UK150001` / `UK01` example directly.

`workers/vf-ui/test-browser/coding-lists.test.ts` (new, 11 tests) —
Company code read-only with no Add button; Cost Centre's empty state,
listing, minimal create, and full edit (parent/approver/limit/filter)
posting exactly the extended route's own shape; Project's indentation
and hierarchy-aware create; General Ledger Code's two declared filters
rendered as real columns and offered as real pickers sourced from
units and the commodity-code list; a save failure leaving the form
open with the shared error string.

`workers/vf-ui/test-browser/ap-setup.test.ts` (updated) — the stale
"Account Coding shows the same not-built placeholder" test (now
false) replaced with real coverage that all five sub-tabs render; the
shared `openApSetupAs()` helper's default stubs extended for the four
new fetches every existing test in this file already goes through.

`workers/vf-licence/migrations/0147_account_coding_strings.sql` (new)
— 22 keys × 2 locales (44 rows), added to `string-coverage.test.ts`'s
own `KEYS_THE_INTERFACE_USES` for real coverage.

`vf-ui`'s two proxy allowlist entries (`/org/cost-centres`,
`/cost-centres/:id`, plus the two new `/coding-lists/*` patterns) added
to `workers/vf-ui/test/index.test.ts`'s own `CALLED_BY_A_SCREEN`
regression guard.

`eslint .` clean across all three workspaces. Full, unfiltered suites
run in every workspace: `vf-app` **2561/2561** (112 files), `vf-licence`
**320/320** (21 files), `vf-ui` **74/74** Worker (2 files) + **987/991**
browser (47/48 files). The four browser failures are all in
`test-browser/tasks.test.ts` (decision 0346's nav-listing tests,
untouched by this decision) and confirmed present on a clean checkout
of `origin/main` with none of this decision's files applied — a
pre-existing, unrelated flake, not introduced here.

`python3 migrations/apply_migrations.py --replay-only` — clean for both
chains: `vf-app` 76 migrations (0076 itself holds 8 assertions), 170
standing invariants re-checked; `vf-licence` 147 migrations, 73
standing invariants re-checked.
