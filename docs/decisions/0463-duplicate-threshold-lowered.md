# 0463 — The Duplicate-Invoice Bar Was Set Above What a Changed Invoice Number Alone Can Ever Score

**Status: confirmed pushed and deployed.** `origin/main` fetched
directly reads `e6f4604`, matching this session's own commit exactly,
and the operator confirmed with *"deployed and pushed."* No
migration — `vf-app` only.

---

## What was reported

*"I think we might need to look at the Fraud Prevention Dashboard -
The Potential Duplicate Invoices shows as Empty even though I'd sent
in the exact same invoice many times, with an increment on the
invoice number only."*

## Not a bug in the query — the scoring design itself, already flagged as a known gap

`duplicate_confidence` (decision 0028) is a weighted score, computed
once at submission: same supplier is a hard gate, then an exact
invoice number match is worth `0.6`, an exact total `0.25`, an exact
issue date `0.15`. The operator's own scenario — same supplier, same
total, same issue date, **only the invoice number incremented** —
scores exactly `0.25 + 0.15 = 0.4`. Proven directly, not assumed: an
existing test (`invoice-facts-route.test.ts`, "same supplier, matching
amount and date but a DIFFERENT invoice number") already asserted this
exact `0.4`.

Every screen reading this column filtered at `>= 0.5`:
`dashboard-route.ts`'s `possible_duplicates` card, this decision's own
new `fraud-duplicates-route.ts` table (decision 0420), and
`documents-route.ts`'s `duplicates=1` filter. `0.4` never once crossed
that bar, on any of the three — so the operator's own repeated test
invoices, each scored correctly, never showed up anywhere.

Decision 0028 named this exact shape of gap directly, in its own "What's
still open" section, back when duplicate detection was first built:
*"Fuzzy matching — deliberately declined for this version, in favor of
exact-match explainability. A real, reasonable future enhancement if
false negatives (a genuine duplicate with a typo'd invoice number)
turn out to matter in practice."* It's mattering now — not a typo, a
deliberately incremented number, but the same effect: the one signal
worth `0.6` never fires, and the two signals that do (`0.25 + 0.15`)
were never, on their own, enough.

## Two decisions, put to the operator directly rather than assumed

This is a real product judgment call, not a pure bug fix — asked
directly rather than guessed:

**How to fix it.** Three shapes were on the table: lower the display
threshold (touches only where the score is *read*), rebalance the
underlying weights (touches the score's actual *value*, which matters
because `invoice.duplicate_confidence` is a real field in the closed
rule vocabulary — a customer can and does write their own rule
condition against it, with their own chosen threshold, so reweighting
changes what every existing customer rule evaluates to, not just these
three screens), or add a wholly separate signal alongside the existing
score. **The operator chose lowering the threshold.**

**Whether to backfill.** `duplicate_confidence` is computed once at
submission and never retroactively rescored (decision 0028's own
deliberate design — an earlier invoice shouldn't suddenly read as a
duplicate because something similar arrives later). The operator's own
already-submitted test invoices are stuck at whatever they scored at
the time. A threshold change fixes them automatically — their stored
`0.4` already clears a `0.4` bar the moment it's read, no rescore
needed — which a reweighting would not have offered without a separate
backfill. **The operator chose no backfill**, consistent with choosing
the threshold fix.

## The fix

One new exported constant, `POSSIBLE_DUPLICATE_THRESHOLD = 0.4`, in
`invoice-history.ts` — the shared home `findSimilarInvoices()` and
`SimilarInvoiceCandidate` already live in, and a natural one for
"everything about finding a duplicate" — imported by all three
consumers (`dashboard-route.ts`, `documents-route.ts`,
`fraud-duplicates-route.ts`) in place of each independently stating
`0.5` in its own SQL. **One constant, not three separately-stated
copies of the same number** — the identical drift risk decisions
0461/0462 found the hard way, in CSS rather than SQL, earlier this
session; named directly in this constant's own doc comment so the
next person touching any of these three files sees why.

`0.4` specifically, not `0.45` or anything else in between: it is
exactly the score a matching total and date alone now produce, so that
combination — arguably the stronger fraud signal for *this* pattern,
since a supplier essentially never issues two genuinely different
invoices for the identical amount on the identical date — is what
newly clears the bar. An invoice number match alone (`0.6`) already
cleared `0.5` before this and still does; nothing about that case
changes.

`computeDuplicateConfidence()` itself is untouched — no weight
changed, no new signal added. `invoice.duplicate_confidence` reads
exactly as it always has to a customer's own rule.

## What was not built

- **No backfill/rescore of invoices already on file** — the operator's
  own explicit choice, and unnecessary for the specific report: the
  stored `0.4` scores already clear the new bar as soon as they're
  read.
- **No change to `computeDuplicateConfidence()`'s own weights** — the
  operator's own explicit choice, to avoid changing what any existing
  customer rule against `invoice.duplicate_confidence` evaluates to.
- **No fuzzy/typo'd invoice-number matching** — decision 0028's other
  named gap, still open, still a different problem (an accidental
  near-miss on the number itself, not a deliberately different one
  alongside an otherwise-identical invoice).

## Verification

New test in `fraud-duplicates.test.ts`: submits two invoices through
the real `handleUpsertInvoice()` (not a hand-seeded `duplicate_confidence`
column) — same supplier VAT id, same total, same issue date, only the
invoice number incremented — and confirms the second now appears in
`handlePossibleDuplicates()`'s own result. The two pre-existing
boundary tests ("includes an invoice at or above the threshold" /
"excludes an invoice below it") now assert against
`POSSIBLE_DUPLICATE_THRESHOLD` directly rather than a restated literal,
so they move with the constant rather than needing a second edit if it
ever changes again.

Checked directly, not assumed, that nothing else depends on the old
`0.5`: `ap-assistant.ts`'s own `duplicate_invoices` tool calls
`handlePossibleDuplicates()` and so inherits the new bar automatically,
with no separate threshold of its own. `index.test.ts`'s own
`invoice.duplicate_confidence greater_than 0.5` test is a *customer
rule* example, evaluating the untouched score itself — unaffected,
and correctly so, since this decision deliberately never touched
`computeDuplicateConfidence()`.

`workers/vf-app`: `test/fraud-duplicates.test.ts`,
`test/dashboard.test.ts`, `test/documents.test.ts`,
`test/invoice-facts-route.test.ts`, `test/invoice-history.test.ts`,
`test/ap-assistant.test.ts`, and `test/index.test.ts` — every file
that reads, seeds, or asserts on `duplicate_confidence` anywhere in
the suite — run together: **395/395 passed**, zero regressions.
`npx tsc --noEmit`: 755 lines, two more than the prior 753-line
baseline — confirmed by direct `git stash` comparison to be one new
`TS2352` (the identical `Record<string, unknown> as
PossibleDuplicatesReport` cast every other test in this same file
already has, on the one new test added) plus its own detail line, not
a new class of error and not present anywhere else in the diff.

No `vf-ui`/`vf-licence` change, no new migration, no new string —
`vf-app` only.

## Still to do, operator side

All done — `wrangler deploy` confirmed for `vf-app`, no migration to
apply this time, in the operator's own single report: *"deployed and
pushed."*
