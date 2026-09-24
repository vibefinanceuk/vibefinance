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

## What this leaves open — all six now answered

- **Is quantity matching wanted at all for every org, or should it be
  an on/off toggle?** — **Answered: yes**, an on/off toggle. Build it.
- **Is an org-wide default tolerance wanted independent of this
  feature?** — **Answered: yes**, configurable org-wide, **superseded
  by a vendor-specific tolerance** when one is set — exactly the
  most-specific-wins override shape proposed above and already used
  three times elsewhere in this codebase.
- **Does "PO Buyer" as a real routing target matter enough to build
  the schema for it now?** — **Answered: yes.** Build it now, not
  deferred to a later version. Scope given directly alongside the
  answer: *"this would be a user setup in the users section, with
  permissions. They can view an invoice, comment on invoices."* This
  settles decision 0465's own open question about how far Business
  User access goes, at least for a first version — **view and comment,
  not necessarily resolving a task themselves** — narrower than "can
  do everything AP can," and exactly the two capabilities (reading the
  comment thread, posting to it) decision 0465 already named as
  needing the new per-invoice ownership check.
- **Should "PO line not found" be its own exception/rule?** —
  **Answered: yes.** `po.line_reference_found` ships as its own fact,
  distinct from `po.line_price_matched`/`po.line_quantity_matched`,
  exactly as proposed above.
- **Should unit-of-measure mismatch become its own surfaced
  exception?** — **Answered: yes.** A new fact is needed for this —
  not named in the original vocabulary-split proposal above, which
  only split price and quantity. Call it `po.line_unit_mismatch`:
  `true` when both sides carry a unit and they disagree, `false`
  when they agree or either side has none. This is what today silently
  makes the quantity check skip rather than fail; splitting it out
  means quantity matching can go back to only ever meaning "quantity
  compared and agreed," with the unit disagreement surfaced honestly
  as its own thing rather than hidden inside a pass.
- **Does `AP.Match` need the same route-widening `AP.Code` got?** —
  **Answered: yes.** Build it now, not deferred — the same routes
  decisions 0455/0456 widened for `AP.Code` (document open, task
  search) get `AP.Match` added alongside `AP.Validate`/`AP.Code`.

## The operator's own answers, and what each implies

Three direct answers, received after this document's first draft.
Restated precisely, then checked against the code the same way
everything above was — each is more than configuration; each names
real, specific new work.

**1. The PO Buyer is a real business user, not a placeholder.**
*"The PO Buyer is a real business user, who has requested the goods
or service on the PO, and we would want to engage them in the process
for managing exceptions, confirming goods and service received, etc.
The user would need to be someone setup in the system and be a
'Business User' role for engaging in dialogue (via chat) on specific
invoices relating to a PO, or indeed who have been responsible for
buying goods and services 'off-PO', which result in Non-PO invoices.
I foresee that a Person Reference field would need to be added to the
PO information that we hold, that should be an actual person in the
users database."*

This settles the open question from the first draft — worth building,
not deferred — and names three separate pieces, checked one at a time:

- **A Person Reference field on `purchase_orders`.** Straightforward:
  a nullable `buyer_user_id REAL NOT NULL REFERENCES org_users(id)` —
  the same shape `cost_centres.owner_user_id` already is — sourced from
  wherever POs are loaded from (0370's CSV/XML ingestion), the same way
  `originator_reference` already is. Confirmed no such column exists
  today, on either `purchase_orders` or `invoice_headers`.
- **A Person Reference for a Non-PO invoice is a genuinely separate
  piece, not the same field.** A Non-PO invoice has no `purchase_orders`
  row to attach a buyer to — the operator's own phrase, "off-PO,"
  names the gap directly. This needs its own place to live, most
  naturally on `invoice_headers` itself (a `requested_by_user_id`,
  keyed at whatever point in intake/validation a person becomes
  knowable — today nothing captures "who asked for this" for a
  non-PO invoice at all). **Two fields, two different tables, not
  one** — conflating them would silently lose the distinction the
  operator's own two examples draw.
- **"Business User" is a new role, and needs a new permission
  namespace, not a spot in `AP.*`.** Every existing `AP.*` permission
  (`permissions.ts`) is Accounts Payable staff work — validating,
  matching, coding, approving, reviewing. A business user who happens
  to have raised a PO is not AP staff and should not need an AP
  permission to talk about their own invoice. The precedent already in
  this codebase is `Supplier.Maintain` — "a separate namespace...
  matching decision 0333's own 'namespaced by business role, not by
  route.'" A `Procurement.*` (or similarly named) category, with
  something like `Procurement.Respond`, is the same move, not a new
  one.
- **"Engaging in dialogue via chat" needs more than a permission —
  it needs a genuinely new *kind* of access check.** The comment
  thread already exists (`document_comments`, decision 0267) and
  already works — but both reading (`GET /documents/:id/activity`) and
  posting (`POST /documents/:id/comments`) are gated on one flat
  permission, `AP.Review`, checked the same way for every invoice in
  the org: *"internal only for honest dialogue between colleagues"* —
  colleagues meant AP staff when that was written. Every permission
  check anywhere in this codebase today is that shape: **do you hold
  this permission, full stop** — never **do you hold this permission
  *for this specific record***. A business user should see and
  comment on invoices that name *them* as the buyer or requester, and
  no others — which is a per-invoice ownership check, not a role
  grant. Nothing in this codebase does that yet, for anything. This is
  the single largest new mechanism this answer implies, not a
  configuration detail.

**2. Typical exceptions as configurable, toggleable rules.** *"The
Typical exceptions need to be captured, perhaps as rules in the rule
configuration. Perhaps we also consider a check-box in the AP Setup
screen to enable, or disable standard matching rules?"*

Checked against how rules actually work here: **every rule in this
system is already the same shape** — a sentence a person writes
(`rule_versions.source_text`), compiled against the closed vocabulary,
and a person activates it (`approved_by`, never auto-promoted). Every
rule already carries its own `enabled` flag (`rules.enabled`, decision
0001, unused by nothing — a real column since the very first
migration). There is no separate concept anywhere of a "system" or
"built-in" rule distinct from a customer-authored one, and building
one would be a real departure from decision 0031's own governing
principle — "the vocabulary is closed, and that is the feature,"
applied to rules meaning exactly one thing, a sentence a customer
wrote.

**The simpler reading fits what's already here**: ship a small set of
**pre-written sentences** for the new facts this document already
proposes (`po.line_price_matched`, `po.line_quantity_matched`,
`po.line_reference_found`) — starter text like *"If a line's price
does not match its purchase order line, assign a task to the AP
Matching team requiring AP.Match"* — that Matching's own AP Setup tab
offers as one-click checkboxes. Checking one runs the existing
compile-and-activate pipeline exactly as if the operator had typed it
and pressed activate; unchecking one disables the resulting rule via
the `enabled` flag that already exists. **No new rule mechanism, no
parallel path around the compiler** — the checkbox is a shortcut into
infrastructure that is already there, not a second kind of rule.

**3. A routing drop-down per exception: AP Team / PO Buyer / Other.**
*"For each matching exception, we could configure a drop-down stating
whether the resolution is the AP Team, or PO buyer, or Other (where a
specific user or team can be specified)."*

Two of the three options are what `assign_task` already does —
**"AP Team"** and **"Other: a specific user or team"** both resolve to
a literal `{ team: "<id>" }` or `{ user: "<id>" }`, exactly the shape
`assign_task` has taken since decision 0019. **"PO Buyer" is not**:
it can't be a literal id chosen once in AP Setup, because it means a
different person on every invoice — whoever's Person Reference (above)
that invoice's own PO carries. `assign_task`'s params
(`ACTION_DESCRIPTIONS`, `shared/interpreter/vocabulary.ts`) are always
a literal team-or-user id today; nothing resolves a target *from the
invoice being evaluated*. This needs a genuinely new action shape —
something like `assign_task { role: "po_buyer" }` — resolved by the
workflow engine at evaluation time by reading the invoice's own linked
PO (or the new non-PO requester field) rather than trusting a rule's
own stored parameter, the same *kind* of per-invoice resolution
`resolveApprovalTargets`/`resolveCostObjects` (decision 0452) already
do for cost-object approval, generalized to a new purpose rather than
invented from nothing.

## What this newly leaves open

- **Where the non-PO requester reference is captured — still open.**
  Nothing in intake or validation asks "who requested this" today for
  an invoice with no PO. Is it keyed by a person at Validation,
  inferred from somewhere else entirely, or left unset (and the
  "Other" routing option used) until a real mechanism exists?
- **How wide "Business User" access should be — answered, for a first
  version.** *"They can view an invoice, comment on invoices"* — given
  with no qualifier about an exception being open, read as **every
  invoice naming them as buyer/requester, full stop**, not scoped to
  only while a matching exception is active. The per-invoice ownership
  check below is built to that shape.
- **Whether a Business User needs anything beyond Chat — answered, for
  a first version.** *"They can view an invoice, comment on
  invoices"* names exactly those two capabilities and no others —
  **not** resolving a task themselves. `assign_task { role: "po_buyer"
  }` tasks (0465) still need to be genuinely workable by *somebody*,
  but that stays AP's own task, worked through the AP Team / Other
  routing options; a Business User's own role is read-and-comment, not
  task resolution, unless a later decision widens it.

## A tension the two answers above create, surfaced rather than silently resolved

**If "PO Buyer" is a selectable target in the per-exception routing
drop-down (0465, question 3), and a Business User can only view and
comment, not resolve a task (just above) — who actually completes a
task routed to "PO Buyer"?** `assign_task` creates a real task with a
`required_permission`; completing one has always meant holding that
permission (`onTaskCompleted`'s own gate, unchanged by anything
proposed here). A Business User holding only a read-and-comment
`Procurement.*` permission could see the task's invoice and discuss it
in chat, but could not check it off — the same "reserved but not
enforced" shape `AP.Match` itself was already in.

Two honest readings, not assumed either way:

- **"Route to PO Buyer" means bring them into the conversation, not
  hand them the task.** The task itself still goes to an AP-held
  permission (`AP.Match`, most likely) — practically, this reads as
  "AP Team," with the Business User cc'd via chat for their input,
  which would make "PO Buyer" a *notification* target, not a distinct
  `assign_task` target, and the new `assign_task { role: "po_buyer" }`
  resolution mode (0465) would not be needed for a first version at
  all — `notify { target: "po_buyer" }` (a resolution the existing
  `notify` action would need the same kind of new per-invoice lookup
  for) might be the more accurate shape.
- **A Business User is meant to actually resolve the task**, and the
  answer just above ("view an invoice, comment on invoices") was
  describing the minimum, not the ceiling — in which case the
  `Procurement.*` permission this document proposes needs to carry
  real task-completion rights for matching-exception tasks
  specifically, not only read-and-comment, and `onTaskCompleted`'s own
  gate needs nothing changed (it already just checks the permission),
  but the permission itself needs to mean more than this document has
  proposed so far.

**Worth a direct answer before `assign_task { role: "po_buyer" }` (or
`notify`) gets built either way** — the two readings produce a
genuinely different feature.

## What was not built

Everything above is investigation and this document, including the
operator's own answers and what they imply. No new
`org_matching_config` (or equivalent) table, no `buyer_user_id` on
`purchase_orders`, no requester field on `invoice_headers`, no new
`Procurement.*` permission, no per-invoice ownership check anywhere,
no `po.line_reference_found`/`po.line_price_matched`/
`po.line_quantity_matched` vocabulary entries, no `assign_task { role
}` resolution, no change to `po-matching.ts` or `validation.ts`, no
route, and `ap-setup.js`'s Matching tab is untouched — still the same
placeholder decision 0440 left it as. No mock-up was built this time,
since none was asked for; happy to produce one (in the same style as
`docs/design/mockups/cost-object-approval.html`) once the newly open
questions above have answers, so it mocks up something real rather
than guessing at the configuration shape.
