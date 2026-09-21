# 0433 — The manual supplier search ranks by the invoice's own org

**Status: built, tested, documented. Not yet confirmed pushed and
deployed** — this session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0432 already used.

---

## What was found

Live testing surfaced an invoice (`TEST-ORG-0020`, Northwind Logistics
Ltd, VAT `GB447711223`) whose seller matched two active sites sharing
that VAT number, neither one a pay site — `matchSupplier`'s own
`ambiguous_site` outcome. The operator reported it directly: *"however
when I open the invoice it states that the supplier could not be
recognised"*, alongside a screenshot showing the invoice had already
run through every stage — Intake, Validation, Matching, Coding,
Approval — to payment-eligible despite that.

Investigating that found two separate things, not one:

1. **Nothing currently blocks on an unmatched or ambiguous supplier.**
   `supplier.matched` and `supplier.unmatchedReason` are already real
   facts a rule can test (`shared/interpreter/vocabulary.ts`), and
   creating a task is already an ordinary rule action — but no
   migration in this repository seeds a rule that tests either fact at
   any stage, so whether one exists at all is entirely this tenant's
   own rule configuration, not something a code change controls.

2. **The screen a person reaches to resolve it has no idea which org
   the invoice belongs to.** `openSupplierSearch()`'s picker calls
   `/api/suppliers/search?q=...` — a plain free-text search across
   every active supplier in the system, exactly as decision 0222 built
   it. It carries no signal at all about which buying entity the
   invoice was actually placed under, so a person resolving an
   ambiguous match sees every candidate as equally plausible — the
   same tie `matchSupplier`'s own automatic attempt already resolves
   internally (decision 0317: *"the supplier might have a different
   ERP Identifier per Org"*) is presented to a human with the one
   signal that would resolve it removed.

Asked directly what to build: *"I think we need a rule in the
Validation stage to flag for a user to select the right supplier,
based on the Org of the Buying legal entity identified."* Two
questions followed from that, both answered directly:

- **Should the org narrow the picker's candidates, or only rank
  them?** **Rank, never filter** — the same answer decision 0317's own
  tiebreak already gives for the automatic case: a site nobody has
  tagged to an org yet has not thereby said it is *not* the right one,
  and org tagging on a customer's own supplier master file is
  something filled in over time, never a promise it is complete.
  Hiding a legitimate candidate because it has not been tagged yet
  would trade one wrong answer (equal weight to everything) for
  another (an invisible right one).
- **Should the new rule flag every unmatched supplier, or only the
  ambiguous case?** **Only `ambiguous_site`** — `no_identifier` and
  `no_match` already have their own answer, decision 0222's amber
  ribbon and *"leaving it is a real answer... the document may be from
  a genuinely new supplier"*. Ambiguity is different: the supplier is
  known, multiple real candidates exist, and a rule can name the exact
  question a person needs to resolve.

## What was built

**The org-aware ranking — code, shipped in this decision.**
`handleSearchSuppliers` (`workers/vf-app/src/load-suppliers.ts`) takes
a new, optional `orgUnitId` parameter, defaulted to `null` so every
existing caller — and every existing test — searches exactly as it did
before. When given, the query ranks a supplier site tagged to that
same org first (`org_match DESC`, ahead of decision 0218's own
`is_pay_site DESC` tiebreak, then name), via a `LEFT JOIN`-shaped
boolean column rather than a `WHERE` clause — every candidate the
search already found is still returned, only reordered.

`/suppliers/search` (`workers/vf-app/src/index.ts`) reads a new
`orgUnitId` query parameter and passes it through.
`openSupplierSearch()` (`workers/vf-ui/public/viewer.js`) sends
`stored.orgUnitId` — decision 0198's own field, already loaded onto
every invoice the viewer opens — on every keystroke. The picker's own
`describe()` line gains one more marker, read in the same order the
list is now sorted: *"Same org as this invoice"* sits ahead of the
existing *"Payment"* pay-site marker, so a person sees *why* a row is
near the top, not only that it is. One new string,
`suppliers.sameorg` (migration `0143`), reusing the exact `describe()`
technique decision 0222 already built for the pay-site marker.

**The Validation-stage rule — configuration, not code.** `AP.Analysis`-
gated rule sets are tenant data this session has no way to reach (no
migration in this repository seeds a process, a stage, or a rule set
at all — every one of them is created through the product's own Rules
screen). The building blocks the operator asked for already exist and
needed nothing new: a Validation-stage rule testing
`supplier.unmatchedReason equals ambiguous_site`, with an action that
creates a task, is expressible today in the existing rule vocabulary.
Recommended, for the operator's own Rules screen:

- **Stage:** Validation.
- **Condition:** `supplier.unmatchedReason equals ambiguous_site`.
- **Action:** create a task asking a person to confirm the supplier —
  which, opened from that task, is this decision's own newly
  org-ranked picker.

Task visibility already follows the invoice's own `org_unit_id`
(decision 0199/0202), so no separate routing configuration is needed
for the flagged task to reach the right team — that part was already
true before this decision, once the rule itself exists.

## Tests

`workers/vf-app/test/load-suppliers.test.ts` — new describe block,
"ranking a supplier search by the invoice's own org (decision 0433)",
6 tests: ranks the matching org first, flips for the other org, marks
which row matched, never hides a candidate outside the org, degrades
to the existing order with no org given, and an untagged site never
outranks a real org match.

`workers/vf-ui/test-browser/viewer.test.ts` — new describe block, "the
manual supplier search ranks by the invoice's own org (decision
0433)", 3 tests: the search request carries the invoice's own org, an
invoice with no org sends an empty (not literal `"null"`) value, and
the rendered row carries the *"Same org as this invoice"* marker
exactly where the backend flagged it.

`workers/vf-licence/test/string-coverage.test.ts` — **checked, not
extended.** `suppliers.sameorg` was added to `KEYS_THE_INTERFACE_USES`
first, then reverted: `test/setup.ts`'s own migration-application list
stops at `0126` — sixteen migrations behind this one, spanning every
decision from 0425 through 0432 — so migration `0143` is never applied
in this test at all, and no string any of those sixteen decisions
added was ever checked here either. The same pre-existing, unrelated
gap this session already found and deliberately left alone for the AP
Analytics screens' own strings; fixing seventeen migrations' worth of
staleness is not this decision's job.

**Suite state:** `vf-app` load-suppliers 134 → **140** (+6).
`vf-ui` browser `viewer.test.ts` 144 → **147** (+3). `eslint .` clean
across `vf-app` and `vf-ui`.

## What is not built

**The Validation-stage rule itself.** This session cannot reach the
live Rules screen to create it — every building block it needs now
exists, and the exact condition/action is written above for the
operator's own configuration.

**Rule vocabulary or engine changes.** None needed — `supplier.matched`
and `supplier.unmatchedReason` were already first-class facts, and
"create a task" was already an ordinary action, before this decision.

**Filtering the picker to only an invoice's own org.** Explicitly
answered against, above — ranking only, never hiding a candidate.
