# 0370 — Line-level PO matching, computed live, plus a CSV load path

**Status: built.** `po.matched` / `po.variance_pct` are finally
computed — decision 0079 found them declared and computed by nothing;
decision 0081 built the storage they need but left computing them as
future work. This closes that, and goes further: real line-level
matching via `po.line_matched` / `po.line_variance_pct` /
`po.line_quantity_variance_pct`, on the operator's own explicit
instruction that header-only matching does not reflect how any real
customer's AP actually works.

---

## Computed live, never stored

Decision 0081 named the real tension directly: *"at capture it is a
fact about the moment, at evaluation it changes as orders arrive."* A
purchase order is reference data on its own load schedule — it can
genuinely arrive after the invoice that references it. A value computed
once at capture and never revisited would be wrong for exactly the
invoices this exists to help.

So `po.*` is recomputed fresh every time facts are assembled for
evaluation, the same way `supplier.matchOption` and
`invoice.duplicate_confidence` already are — never written into
`facts_json`, never a stored column. `mergePoMatchFacts()` is the one
function every caller goes through, so the header and line computations
can never drift out of sync with each other, or be wired into one call
site and forgotten in another.

**No purchase order at all reads identically to "not yet arrived."** A
rule cannot usefully act differently on "no order was ever named"
versus "one was named but hasn't shown up here yet" — both mean the
same thing today: nothing to check this invoice against.

---

## Line correspondence is `BT-132`, and its absence is honest, not guessed

Checked against the standard before anything was written, the same
discipline `ubl-parser.ts` and decision 0081 already established:
`BT-132`, *Referenced purchase order line reference*
(`InvoiceLine/OrderLineReference/LineID`), is EN 16931's own mechanism
for saying which order line an invoice line answers. It was already
declared in the vocabulary and already extracted by the parser
(decision 0110) — built for exactly this, sitting unused until now.

**The standard's own guidance is a real constraint, not a footnote:**
*"presence of BT-13 does not imply line-level referencing always has to
be provided... order line and invoice line do not always have a
one-to-one relation."*

So there is no positional fallback. `po.line_matched` reads `false`,
never a guess, when `BT-132` is absent — falling back to "invoice line
N is order line N" would report a match that might not be real, which
is worse than an honest "this line couldn't be matched." The same
"refused rather than guessed" standard `po.matched` already sets for a
missing `BT-13`.

---

## Tolerance is not invented here

`supplier.amountTolerancePct` and `supplier.quantityTolerancePct`
already existed (decision 0209), already on every invoice's own facts,
with the schema's own comment already saying exactly what was needed:
*"when a match fails, and by how much before it does."* This reads
them rather than asking for a new setting.

**Amount and quantity are independent checks**, mirroring why the two
tolerances are separate settings in the first place: over-delivering
and over-charging are different failures. A quantity-less line (a
service, a flat fee) is not thereby a bad match on price — its own
absence never fails the line. A unit mismatch between the two sides
(the order says `EA`, the invoice says `BOX`) is treated the same way:
comparing raw numbers across units would be a meaningless variance, not
a real one, so quantity is left out of the verdict rather than reported
wrong.

No tolerance agreed at all means an exact match is required — absence
of an agreed tolerance means nothing has been agreed to deviate from
one.

---

## A real gap found and closed along the way

Tracing every place facts get assembled for evaluation surfaced that
`POST /process-instances/:id/visit` — the route a re-evaluation (after
a task completes, or once a purchase order arrives) actually goes
through — never loaded anything from storage at all. Not `facts_json`,
not the structured columns, nothing. A caller supplying partial facts
by hand would silently lose `duplicate_confidence`,
`supplier.matchOption`, and now `po.matched` too, purely because of
which route the re-evaluation happened to reach.

Fixed the same way `/rules/evaluate` already handles it: when the
instance's own subject is a real invoice, `facts_json` is loaded as the
base layer, the caller's own supplied facts still take precedence over
it (a caller testing a "what if" scenario can still override a specific
field), then the structured columns, then `po.*` — freshest last. Only
applies when `subject_type` is `"invoice"`; the engine stays
deliberately subject-agnostic otherwise, matching decision 0027's own
design.

---

## The CSV load path

`POST /purchase-orders/csv-load`, `Admin.Configure` — the same
permission and the same reasoning as the existing XML ingestion route:
loading orders is setting up what invoices get matched against, not
accounts payable work.

**CSV for the same reason decision 0211 gave suppliers one**: it is
what a customer can produce from any ERP without a Peppol connection,
no integration required. One row per order line, header columns
repeated on every line belonging to the same order — the shape an
ERP's own PO line export already has.

Deliberately **not** a new storage path. A CSV row and a parsed UBL
order converge to the exact same shape before either reaches storage,
via the exact same `storeOrder()` decision 0081 already built — replace-
on-resubmit, the line invariants, everything already proven, without
being rebuilt.

---

## What this does not do

**No Sources/inbound-channel integration.** The operator explicitly
deferred this. The CSV loader is a plain, callable endpoint; a
scheduled inbound channel (HTTPS or SFTP, checked daily) could call
into it later without a redesign, but no scheduling or channel
integration exists yet.

**No Documents-screen rendering of purchase orders.** Also explicitly
deferred, for a later decision.

**No Despatch Advice / three-way matching.** Decision 0082 already
named this as the next real piece and recorded three-way matching as
the confirmed target — T16 remains the missing third leg. This decision
only closes the two-way (invoice-to-order) half.

**No bulk/streaming CSV.** One file, fully parsed and processed in one
request, the same scale decision 0081's own XML path operates at.

---

## Tests

`po-matching.test.ts` — 16 tests directly against `computePoMatch()` /
`computePoLineMatch()` / `mergePoMatchFacts()`: exact matches, tolerance
both sides of the boundary, missing `BT-13`/`BT-132`, a referenced order
or line that doesn't exist, quantity absent on either side, mismatched
units.

`purchase-order-route.test.ts` — 16 tests total, 7 new for the CSV
loader: grouping by order number, replace-on-resubmit, the same
anonymous-line and duplicate-line-number refusals the XML path already
enforces.

Two genuine end-to-end proofs, not just unit coverage:

- `intake-capture-route.test.ts` — a real process with a rule that
  holds an invoice at Matching when `po.matched` is `false`, exercised
  through `handleCaptureIntake` twice: once where the order already
  exists (sails through, no task), once where it doesn't yet (held,
  with a real task on the matching team).
- `index.test.ts` — a rule referencing `po.matched` fired through the
  real HTTP router twice: once via `POST /rules/evaluate` with
  `invoiceId` and no inline facts, once via
  `POST /process-instances/:id/visit` re-evaluating a later stage with
  near-empty supplied facts — proving the gap above is actually closed,
  not just that the merge function itself is correct in isolation.

vf-app: 1,751 tests total (confirmed by running the entire suite,
not just the files touched here).
