# 0318 — The org has to be known before it can help matching

**Status: built.** A real gap in decision 0317's own tiebreaker, found
before it ever reached production.

---

## What was asked

> Validating is an interesting and important stage, because it is the
> first human interaction after the invoice is received from the
> source. The invoice should know the receiving entity due to us
> adding the hard coding of the organisation in the source
> configuration, or automatically derived during the intake process.
> Because of this, the derivation of the supplier should be aligned
> with the supplier record for the relevant org.

Investigated the actual capture code rather than assuming decision
0317's own tiebreaker already covered this. It did not, for exactly
half of what the operator described.

## What was found

`source-capture-route.ts` has two places a document is captured, and
each does the same three things in the same order: apply the source's
own hard-coded org if it has one, match the supplier, then — only
where no hard-coded org exists — derive one from the document itself
(`BT-48`, the buyer's own VAT id).

**The hard-coded case already worked.** A source with its own default
org sets it before matching runs, so decision 0317's tiebreaker always
had something to consult.

**The derived case did not.** `deriveOrgUnit` ran *after* matching, so
for any source without a hard-coded default — the operator's own
`<Automatic>`, one mailbox for everybody — the org genuinely did not
exist yet at the moment the tiebreaker needed it. The fix built last
session was correct and fully tested in isolation, and would have
silently done nothing for this entire case.

## What was built

**Both capture functions reordered**, so org derivation runs before
supplier matching in every case, not only the hard-coded one.
Confirmed safe before touching it: `deriveOrgUnit` reads only the
invoice's own facts, nothing before it in either function reads
anything supplier-matching writes, and nothing between the two blocks
depended on the old order.

A new comment at the point of the swap explains why the order now
matters, since nothing in either function's own type signature would
tell a future reader that.

## What has coverage

**The re-match sweep** (`rematchUnmatchedInvoices`, the third real
call site, in `load-suppliers.ts`): an invoice already carrying its
own org, re-matched after a load that creates two suppliers sharing
one VAT — one per org — resolves to the one for its own org rather
than becoming newly ambiguous.

**The full capture path itself**, not just the tiebreaker or the
sweep in isolation: a real UBL document, carrying both a seller VAT
(ambiguous between two suppliers) and a buyer VAT (resolving to a real
org), captured through a source with no hard-coded default. Confirmed
the invoice ends up with both the correct `org_unit_id` — proving
derivation ran — and the correct `supplier_id` — proving matching used
it. This test needed the actual UBL buyer-party XML shape, found by
reading the shared parser directly rather than guessing at it.

Both new tests probed directly. The end-to-end one was probed against
the reordering itself: forcing the org to null at the matching call
site — functionally the exact shape of the original bug — fails it
correctly.

vf-app: 1507 tests (was 1505). No frontend changes; `vf-ui` reconfirmed
unaffected at 412. No migration.

## What is not built, and this matters

**Nothing about approving, returning, or any other write-side action
changed.** This was specifically the capture-time path the operator
asked about — the point at which validating first meets a document —
not a broader pass over every place `org_unit_id` and supplier data
interact.
