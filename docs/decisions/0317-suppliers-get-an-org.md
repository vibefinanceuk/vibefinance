# 0317 — Suppliers get an org, and matching learns to use it

**Status: built.** The fourth screen, and a real correctness fix to
supplier matching found along the way.

---

## What was asked

> Please can you look at suppliers now

Investigated the actual data model first, having learned the lesson
of checking thoroughly rather than assuming. Suppliers had no org
concept at all — genuinely different from Tasks, Documents, and the
Dashboard, which all already had `org_unit_id` to narrow by. Decisions
0207/0208 had evaluated exactly this question before: the operator
settled on *"we are the mirror... a small subset of the information
that impacts workflow,"* deliberately not Oracle's full,
site-partitioned model — but left a specific, forward-compatible hook:
*"a single table with a nullable site identifier holds the one-row
case exactly and extends to the second without a migration that moves
data."* That hook, `erp_site_identifier`, is the ERP's own free-text
site code — never linked to this system's own `org_units`.

Confirmed with the operator: build the schema column, extend the load
spreadsheet to set it, and narrow the list by it.

## A second, real correctness gap, found before shipping

The operator's own follow-up: *"the supplier might have a different
ERP Identifier per Org."* The schema already handles this — a supplier
row's identity is its `erp_identifier`, so two rows for what is
conceptually one company, one per org, work without any change.

**What does not automatically follow: matching.** `matchSupplier()`
recognises a supplier by VAT number or electronic address — properties
of the real company, not the ERP's per-org identifier — so an arriving
invoice would now match *both* rows where before it matched one. There
is already a fallback for exactly this shape of ambiguity
(`is_pay_site`, decision 0218), but it was not built with per-org
duplication in mind, and would report `"ambiguous_site"` far more
often for invoices that are actually perfectly identifiable once the
org is known.

This sits directly against an existing, deliberate principle the code
already states: matching is *"independent of the org... treating
either as one answer would hide half of what is wrong."* Confirmed
with the operator before touching it, rather than deciding
unilaterally: **use the invoice's own org only as a tiebreaker**, never
as a primary signal — consulted only where `is_pay_site` has already
failed to resolve a tie, so the ordinary, non-ambiguous case never
consults org at all and the existing principle holds for it exactly as
before.

## What was built

**A new, nullable `org_unit_id` column on `suppliers`**, the same
"unassigned is a real, expected state" pattern used everywhere else in
this arc. Every existing supplier becomes unassigned on the day this
lands, not orphaned.

**The load spreadsheet accepts an org unit column**, several
human-readable aliases (`Org Unit`, `Organisation`, `Legal Entity`),
resolved against real unit names at load time — one query for the
whole load, not one per row. A name that does not resolve refuses the
row with a clear reason rather than silently leaving it unassigned;
a blank column is genuinely different and means exactly that.

**`handleListSuppliers` narrows to the chosen org**, the same
`unitsBeneath()` decisions 0314 and 0315 already use. One real
difference from those two: there is no permission-based visibility to
intersect against first, since reading the list has never been
unit-scoped — this is the first restriction of any kind. **An
unassigned supplier always stays visible**, deliberately, regardless
of which org is chosen: nothing assigns one automatically yet, and
hiding every supplier the moment somebody focused on an org would look
like a broken screen rather than an honest "nothing here is assigned."

**`matchSupplier()` takes the invoice's own org as an optional third
parameter**, threaded through from all three real call sites — capture
time (twice, in `source-capture-route.ts`) and the re-match-after-a-
load sweep in `load-suppliers.ts`. Consulted only when `is_pay_site`
leaves more than one candidate, and only ever narrows to a row
*explicitly* tagged with the invoice's own org — an unassigned row is
never treated as a match for any org, since it has not said it is not
a match either, and doing so would leave the tie exactly as wide as
before.

**`suppliers.js` sends the chosen org**, the same way `tasks.js`,
`documents.js`, and `dashboard.js` already do.

## What has coverage

**Load and resolution**: refuses an org unit nobody recognises;
resolves a recognised one by name, case-insensitively; leaves a
supplier unassigned when the column is absent; resets to unassigned on
a later load that omits it, matching how every other field already
behaves under "replace, not merge" (decision 0208).

**Narrowing**: shows only the chosen org's own suppliers; an
unassigned supplier stays visible regardless of which org is chosen;
everything shows when nothing is chosen.

**Matching's own tiebreaker**: resolves a tie using the invoice's own
org; stays ambiguous when the invoice's org matches no candidate;
stays ambiguous when the invoice's org is not known at all; does not
treat an unassigned candidate as a match for any org; never needs the
org where the match already resolves to one row, proving the existing
"independent of the org" principle still holds for the ordinary case.

Thirteen new backend tests in total. Four probed directly — the org
resolution/refusal logic, the tiebreaker itself, and the
unassigned-candidate safety property — each fails exactly the test
written to catch it.

Two new frontend tests: the chosen org is sent to `/api/suppliers`; no
`org` parameter is sent when nothing has been chosen. Probed directly.

vf-app: 1505 tests (was 1492). vf-ui: 49 Worker, 412 browser (was
410). One migration.

## What is not built, and this matters

**Nothing assigns a supplier's org automatically.** The only path is
the load spreadsheet's own new, optional column — no UI to set or
change it, and no attempt to infer it from an invoice's own org
placement. A customer whose supplier file has never carried this
column will see every supplier as unassigned indefinitely, which is
correct, not a bug: the mirror shows what it was told.

**Every write-side action remains unaffected by which org is
chosen** — keying, validating, approving, returning. Four of the app's
screens now respect the switch; the write path does not. Approval
limits remain unscoped and unenforced, and there is still no UI to
view, assign, or manage role allocation, both unchanged from where
decision 0313 left them.
