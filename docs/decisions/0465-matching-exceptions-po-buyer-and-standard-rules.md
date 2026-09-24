# 0465 — Matching Exceptions: The PO Buyer, Standard Rules, and Per-Exception Routing, Answered

**Status: investigated and documented, not built.** A direct follow-up
to decision 0464, answering three of that document's own open
questions and working out what each answer actually requires. No
migration, no vocabulary change, no route, no screen.

---

## What was asked

Three direct answers to open questions decision 0464 named:

1. *"The PO Buyer is a real business user, who has requested the goods
   or service on the PO, and we would want to engage them in the
   process for managing exceptions, confirming goods and service
   received, etc. The user would need to be someone setup in the
   system and be a 'Business User' role for engaging in dialogue (via
   chat) on specific invoices relating to a PO, or indeed who have
   been responsible for buying goods and services 'off-PO', which
   result in Non-PO invoices. I foresee that a Person Reference field
   would need to be added to the PO information that we hold, that
   should be an actual person in the users database."*
2. *"The Typical exceptions need to be captured, perhaps as rules in
   the rule configuration. Perhaps we also consider a check-box in the
   AP Setup screen to enable, or disable standard matching rules?"*
3. *"For each matching exception, we could configure a drop-down
   stating whether the resolution is the AP Team, or PO buyer, or
   Other (where a specific user or team can be specified)."*

## What was found

Each answer is more than configuration — each names real, specific new
work, checked directly against the code:

**The PO Buyer is three separate pieces, not one.** A `buyer_user_id`
on `purchase_orders` is straightforward — the same shape
`cost_centres.owner_user_id` already is, and no such column exists
today. A **Non-PO invoice has nowhere to attach a buyer at all** — it
has no `purchase_orders` row, so its own requester needs a field of
its own, most naturally on `invoice_headers`. And **"Business User"
needs its own permission namespace**, not a slot in `AP.*` — every
`AP.*` permission is Accounts Payable staff work, and the precedent
already in this codebase for a genuinely separate business function is
`Supplier.Maintain`'s own namespace (decision 0333's "namespaced by
business role, not by route"). The largest piece is none of these
three: **"engaging in dialogue via chat" needs a per-invoice ownership
check that exists nowhere in this codebase today.** The comment thread
already works (`document_comments`, decision 0267) but both reading
and posting are gated on one flat permission, `AP.Review`, checked the
same way for every invoice in the org — "internal only for honest
dialogue between colleagues," where colleagues meant AP staff. Every
permission check in this codebase today asks "do you hold this
permission," never "do you hold it *for this specific record*." A
business user seeing only invoices that name them is the first place
this system would need the second kind of check.

**Standard, toggleable rules fit the existing rule infrastructure
without a new mechanism.** Every rule here is already a sentence a
person wrote (`rule_versions.source_text`), compiled against the
closed vocabulary, and explicitly activated — never auto-promoted —
and every rule already carries an `enabled` flag, a real column since
the very first migration (decision 0001). There is no existing concept
of a "system" rule distinct from a customer-authored one, and building
one would cut against decision 0031's own governing principle for what
a rule is. The simpler reading — pre-written starter sentences for the
new facts decision 0464 proposed, offered as one-click checkboxes in
AP Setup that run the existing compile-and-activate pipeline, and
toggle the existing `enabled` flag to turn off — needs no new
mechanism at all.

**Two of the three routing options already exist; the third is
genuinely new.** "AP Team" and "Other: a specific user or team" are
both `assign_task { team }` / `{ user }` exactly as it works today.
"PO Buyer" cannot be a literal id chosen once in AP Setup, because it
names a different person on every invoice — this needs a new action
shape, `assign_task { role: "po_buyer" }` or similar, resolved by the
workflow engine at evaluation time from the invoice's own linked PO or
requester field, the same *kind* of per-invoice resolution decision
0452's `resolveApprovalTargets`/`resolveCostObjects` already do for a
different purpose, generalized rather than invented from nothing.

Full reasoning, and four newly-open questions (where a non-PO
requester is captured, how wide Business User access should be,
whether they need to resolve tasks or only comment, and how the two
Person Reference fields relate) are in
`docs/design/two-way-matching-exceptions.md`, appended to decision
0464's own document rather than split into a second file — the
answers extend the same investigation, not a new one.

## What was built

An addendum to `docs/design/two-way-matching-exceptions.md`: the
operator's own three answers restated precisely, what each implies
checked directly against the code (a new `buyer_user_id` column, a
separate non-PO requester field, a new `Procurement.*`-style
permission namespace, a genuinely new per-invoice ownership check for
chat access, reuse of the existing rule-compile-and-`enabled`
infrastructure for "standard rules," and a new `assign_task { role }`
resolution mode for PO Buyer routing), and four further open
questions.

## What was not built

Everything above is documentation. No `buyer_user_id` column, no
non-PO requester field, no new permission, no per-invoice ownership
check, no new rule mechanism, no `assign_task { role }` resolution, no
route, no screen change. Decision 0464's own six open questions and
this decision's four are all still open.

## Still to do, operator side

Read the addendum in `docs/design/two-way-matching-exceptions.md` and
answer the four newly-open questions, in particular how wide Business
User access should be and whether a Business User needs to actually
*work* a task (resolve it) or only comment on one via chat — that
decides whether the PO Buyer routing option needs real task
enforcement built for it, or only visibility. Nothing to deploy or
apply — this decision touches no running code and no migration.
