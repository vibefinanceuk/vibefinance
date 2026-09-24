# Two-way matching exceptions — what they are, how AP departments resolve them, and what Matching should configure

**Status: investigated, not built.** The operator's own framing: intake
and validation exist to get the data right; **matching** — patching an
invoice line to a PO line — happens *during* Validation, using
machinery already built (decisions 0081, 0370); the **Matching stage**
itself is where the *exceptions* that fall out of that matching are
worked. Asked directly: what exception types do real AP departments
see, how are they typically resolved, and what should the Matching tab
in AP Setup let an operator configure — which fields to match on,
tolerance by org or by supplier, and who an exception routes to. This
is that investigation. No migration, no vocabulary change, no route,
no screen.

---

## What already exists, checked directly rather than assumed

**Matching itself already runs, at both header and line level**
(`po-matching.ts`, decisions 0081/0370), recomputed fresh on every
evaluation rather than stored — a purchase order can arrive after the
invoice that references it, so a value computed once at capture would
be wrong for exactly the invoices this exists to help. Header: BT-13
(the invoice's PO reference) joined to `purchase_orders.order_number`,
BT-112 (invoice total) compared to `payable_amount`. Line: BT-13 **and**
BT-132 (`OrderLineReference/LineID`) joined to a specific
`purchase_order_lines` row, BT-131 (line net amount) compared to
`line_extension_amount`, and — independently — BT-129/BT-130
(quantity/unit) compared to the order line's own quantity/unit. No PO
reference, an order not yet on file, or no matching line all read the
same way: **not matched**, never guessed from position. A unit-code
mismatch between the two sides skips the quantity check rather than
comparing incompatible numbers.

**Tolerance already exists, and is already supplier-specific, not
org-wide** — `supplier.amountTolerancePct` / `supplier.quantityTolerancePct`
(decision 0209), two independent percentages on the supplier record,
loaded from the ERP mirror/CSV. Kept apart deliberately: over-delivering
and over-charging are different failures. **There is no org-level
default today.** A supplier with no tolerance set reads as `0`
(`?? 0` in `po-matching.ts`) — exact match required — silently, for
every supplier the ERP mirror hasn't given one to. That is a real gap
today, independent of anything proposed below.

**Validation already surfaces one combined check, not separate ones.**
`validation.ts`'s `po_mismatch` check fires per line when
`po.line_matched` is `false` — but that boolean is `amountOk && quantityOk`
computed once in `po-matching.ts`; nothing downstream, including the
rule vocabulary, can tell *which* one failed, or distinguish "genuinely
compared and disagreed" from "no order line was ever found to compare
against." The two variance numbers (`po.line_variance_pct`,
`po.line_quantity_variance_pct`) are attached and shown on the
Validation screen's own comparison text, but a **rule** has only the
one collapsed boolean to test.

**A rule cannot apply a variable tolerance itself.** `Condition.value`
(`shared/interpreter/types.ts`) is always a literal, array, or range —
never another field. This is exactly *why* `po.matched`/`po.line_matched`
exist as pre-computed booleans rather than leaving a rule to write
`po.line_variance_pct greater_than 5`: a literal in a rule can't vary
by supplier, so the tolerance has to be applied server-side, once,
before the rule ever sees a boolean. Any new exception type needs the
same treatment — a fact the platform computes, not a number a rule
author guesses.

**Routing to a team needs no new engine capability.** `assign_task`
already accepts `{ team: "<team id>" }` or `{ user: "<user id>" }` plus
a permission (decision 0200 lets a stage declare its own, so a rule can
omit it). Creating an "AP Matching" team is already possible today
through Access → Teams (0332/0333) with no code change.

**`AP.Match` already exists in the closed permission vocabulary — and
is enforced nowhere.** `permissions.ts` lists it plainly:
`"AP.Match": "Three-way match against a purchase order — not yet
built."` No route in `index.ts` checks for it. This is exactly the
state `AP.Code` was in before decisions 0455/0456 widened the specific
document-open and task-search routes (`AP.Validate` OR `AP.Code`) to
also accept it — the same widening would be needed for `AP.Match`
before a person holding *only* that permission could actually open or
work a matching-exception task.

**There is no "PO buyer" as a person, anywhere in the schema.**
`purchase_orders.buyer_party_id` is a party/organisation identifier —
the same kind of thing `BT-48`/buyer VAT id is for an invoice — not a
specific user. Routing an exception to "the PO buyer" who raised it is
not buildable today without new schema: a requester/buyer `user_id` on
`purchase_orders`, sourced from wherever POs are loaded from (0370's
CSV/XML ingestion). This is the same shape of blocker Cost-Object
Approval Hierarchy (0450) found for Project/Commodity Code/GL Code
approval — a real, separate, named gap, not a detail to gloss over.

**The Matching tab already exists in AP Setup, as a placeholder.**
`ap-setup.js`'s own `TABS` array has carried `{ key: "matching",
labelKey: "apsetup.matching" }` since decision 0440, rendering
`placeholderCard("apsetup.matching")` — genuinely greenfield, named
that way in the screen's own header comment, not a screen deferred by
accident. This is exactly where a real Matching configuration screen
belongs.

**"PO Line Not Matched" is the operator's own live rule, invisible to
this repo** — the same category as the live Coding stage decision 0451
found: created at runtime in the customer's own rule set, not checked
in here. Given only one boolean (`po.line_matched`) to test, it cannot
today distinguish "no order line was ever found" from "found and
disagreed on price" from "found and disagreed on quantity" — all three
collapse to the same `false`.

---

## What typical AP departments treat as 2-way match exceptions

Checked against current practice, not just recalled — the categories
line up closely with what this codebase already computes or is close
to computing:

1. **No PO, an invalid PO reference, or a PO not yet on file.** BT-13
   present but no matching `purchase_orders` row — or absent
   altogether. Already `po.matched === false` with no variance number
   attached (nothing was actually compared).
2. **PO referenced, but the specific line can't be found.** BT-13
   resolves to a real order, but BT-132 names a line that doesn't
   exist on it, or BT-132 is itself absent. Same collapsed `false`
   today as case 1, at line level.
3. **Price/amount discrepancy.** The invoice line's net amount
   disagrees with the order line's, beyond tolerance. Already computed
   (`po.line_variance_pct`), just not exposed as its own boolean.
4. **Quantity discrepancy — usually over-billing.** The invoice claims
   more (or, less commonly, less) than the order line's own quantity,
   beyond tolerance. Already computed (`po.line_quantity_variance_pct`),
   same gap.
5. **Unit-of-measure mismatch.** The order says `EA`, the invoice says
   `BOX` — today this silently skips the quantity check rather than
   being flagged as its own exception. Real AP practice treats this as
   worth surfacing, not silently ignoring, since a skipped check reads
   identically to "quantity agreed" from a rule's point of view.
6. **A PO fully consumed already.** Every line already invoiced in
   full, and a further invoice arrives against it. `po.matched`
   (decisions 0370's own Active/On-Hold/Closed status, "Invoiced
   Part/Full derived live") already has the data this would draw on;
   nothing computes "is there anything left to match against" as its
   own fact today.

Two categories that come up in the same research are already handled
elsewhere in this codebase under different names, deliberately out of
this investigation's scope: **duplicate invoices** (decision 0463) and
**GL/cost-centre coding errors** (decisions 0451–0463's Coding work).
**Missing goods receipt** is the third leg of 3-way matching — named
already in `HANDOVER.md`'s own gap list (item 10) as the one piece
2-way matching by definition doesn't need.

Sources: [Invoice Exception Handling: Types, Causes, and How to
Reduce](https://autopayables.com/blog/invoice-exception-handling),
[2-Way Matching in Accounts Payable](https://ramp.com/blog/accounts-payable/2-way-match),
[Best Practices for 2-way and 3-way Match](https://optisconsulting.com/best-practices-for-2-way-and-3-way-match/).

## How exceptions are typically resolved

The consistent pattern across the material above, and it maps cleanly
onto a real organisational split: **who owns the discrepancy decides
who resolves it.**

- **Price discrepancies** are usually an AP or dedicated matching
  team's problem — comparing what was agreed contractually against
  what was billed, sometimes contacting the supplier directly.
- **Quantity discrepancies and PO-side problems** (wrong PO, PO not
  found, line missing) are usually the **buyer's/procurement's**
  problem — they hold the PO and the relationship with whoever
  requested or received the goods, and only they can say whether the
  order itself needs amending or the invoice is simply wrong.
- **Larger organisations run a dedicated matching/reconciliation team**
  separate from general AP processing — which is exactly what
  `AP.Match` was already reserved to mean, distinct from `AP.Validate`.
- **Within tolerance auto-clears, no human touch** — already true here
  (`po.line_matched === true` when variance is inside tolerance).

Sources: [Invoice Exception Handling](https://autopayables.com/blog/invoice-exception-handling)
(role-based routing: buyers resolve PO mismatches, AP/controllers
handle coding and general exceptions, receiving teams log missing
receipts), [Accounts payable invoice matching — Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/tasks/set-up-accounts-payable-invoice-matching-validation)
(tolerance configured at both a legal-entity default and a
vendor-specific override, searched most-specific first).

---

## Answering the operator's own questions directly

**Should Matching configure a list of fields to match on?** Keep it
fixed at the two dimensions already computed — amount and quantity —
rather than a generic field picker. The invoice-to-PO field
correspondence isn't arbitrary (BT-131↔`line_extension_amount`,
BT-129/BT-130↔`quantity`/`unit_code` are what BIS Order Only and
EN 16931 actually give you to compare), so a free-form picker would
mostly let someone configure a mapping that doesn't correspond to
anything real. What *is* worth configuring: **whether quantity
matching applies at all** — many 2-way shops match price only,
especially for service lines with no meaningful quantity — as an
on/off toggle, org-wide or per-supplier, rather than a field list.

**Should there be a tolerance percentage per field?** Yes — already
built, already split into amount and quantity independently
(`supplier.amountTolerancePct`/`quantityTolerancePct`). Nothing to add
here except the gap named above: no org-level default.

**Org-wide or supplier-specific tolerances?** **Both**, the same
nullable-override shape this codebase already uses three times over —
`org_units.unit_id` (null means the group's own, decision 0192), the
Employee-Supervisor override tables (0439/0442), and Cost-Object
approval limits (0452). A new `org_approval_config`-shaped single row
(or a new `org_matching_config`) holding an org-wide default amount/
quantity tolerance, with the existing per-supplier columns overriding
it when set — exactly the D365 precedent above (legal-entity default,
vendor-specific override, most-specific wins). This also closes the
silent-0%-tolerance gap named above, since "no supplier override"
would then mean "use the org default," not "use zero."

**Who should an exception route to?** Configurable **per exception
type**, not one fixed target — because the research above and this
codebase's own permission split (`AP.Match` vs. a not-yet-real "PO
Buyer") point the same direction: price variance is AP/matching-team
work, quantity/PO-side variance is buyer/procurement work. Concretely,
today: route to a **team** (AP Matching, or whatever the operator
names it) via the existing `assign_task { team }` mechanism — no new
capability needed for that half. Routing to "the PO Buyer" specifically
needs the schema gap above closed first (a requester/buyer user on
`purchase_orders`); until then, "PO Buyer" isn't a selectable target,
and the Matching config screen should say so rather than offer an
option that resolves to nothing, the same discipline the Cost-Object
mock-up used for "not yet captured on invoice lines."

**What rules can surface these exceptions today?** Only the one
collapsed boolean, `po.line_matched` — which is why "PO Line Not
Matched" can't already be three separate rules. To let a rule react to
each exception type differently (own routing, own permission), the
vocabulary needs splitting, the same "generalized, not rewritten"
treatment 0452 gave the approval resolver:

- `po.line_reference_found` — was a PO **and** a specific line actually
  located to compare against at all (splits "nothing to check yet"
  from "checked and disagreed" cleanly, rather than reading both as one
  `false`).
- `po.line_price_matched` — amount tolerance alone.
- `po.line_quantity_matched` — quantity tolerance alone (still `true`
  when quantity wasn't comparable — the current, deliberate behaviour,
  unchanged).
- `po.line_matched` stays exactly what it is today, the AND of the two
  above, so every existing rule and test that already depends on it —
  including whatever "PO Line Not Matched" already tests — keeps
  working unchanged.

With those in place, "PO Line Not Matched" could stay pointed at
`po.line_reference_found == false`, and two new rules — "PO Line Price
Variance" and "PO Line Quantity Variance" — each test their own new
boolean and route independently, the price one to an AP Matching team
on `AP.Match`, the quantity one wherever the operator decides "PO-side"
work should land until a real PO Buyer exists.

---

## What this leaves open — the operator's to decide before any of it is built

- **Is quantity matching wanted at all for every org, or should it be
  an on/off toggle** — a real, common 2-way-match configuration, not
  named in the original request but surfaced by the research above.
- **Is an org-wide default tolerance wanted independent of this
  feature** — today's silent 0% for any supplier without an explicit
  tolerance is arguably already a bug, not a design choice, and worth
  a decision on its own regardless of what else gets built here.
- **Does "PO Buyer" as a real routing target matter enough to build
  the schema for it now**, or is a named team (AP Matching /
  Procurement) enough for a first version — the same "what's genuinely
  new schema, not yet built" question Cost-Object Approval Hierarchy
  asked about a project code's own origin.
- **Should "PO line not found" be its own exception/rule, distinct
  from "found but disagreed"** — recommended above, not assumed; it
  changes what "PO Line Not Matched" means and may need re-authoring
  rather than leaving as-is.
- **Should unit-of-measure mismatch become its own surfaced exception**
  rather than silently skipping the quantity check — a real gap the
  research surfaced that the original request didn't ask about
  directly.
- **Does `AP.Match` need the same route-widening `AP.Code` got** (0455/
  0456) before this is usable end to end, or is routing tasks to
  `AP.Validate` holders acceptable for a first version — a real,
  separate, and fairly small piece of follow-on engineering either way.

## What was not built

Everything above is investigation and this document. No new
`org_matching_config` (or equivalent) table, no `po.line_reference_found`/
`po.line_price_matched`/`po.line_quantity_matched` vocabulary entries,
no change to `po-matching.ts` or `validation.ts`, no route, and
`ap-setup.js`'s Matching tab is untouched — still the same placeholder
decision 0440 left it as. No mock-up was built this time, since none
was asked for; happy to produce one (in the same style as
`docs/design/mockups/cost-object-approval.html`) once the open
questions above have answers, so it mocks up something real rather
than guessing at the configuration shape.
