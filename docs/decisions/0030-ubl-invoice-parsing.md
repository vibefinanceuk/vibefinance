# 0030 — Real UBL invoice parsing

Status: settled, 1 September 2026. The one piece decision 0029's
intake capture deliberately deferred — everything downstream
(storage, the workflow engine, analytics) was already built and
proven against already-extracted facts. This is what actually
extracts them from a real document.

## Scope decided before building, deliberately

"Document parsing" spans genuinely different technical problems —
structured XML/UBL parsing (deterministic, no AI needed) versus
unstructured PDF/receipt extraction (needs real OCR or a vision
model, a fundamentally different undertaking). Scoped to UBL 2.1
first, the one piece that's pure, correct infrastructure rather than
"real domain modeling" (decision 0026's own phrase for why the harder
cases stay deferred). Confirmed directly, not assumed: Peppol BIS
Self-Billing 3.0 (a formally-routed expense reimbursement, decision
0026) is genuinely the same UBL shape as an ordinary invoice, so this
one parser already covers AP, AR, and formally-routed expenses —
nothing domain-specific about the parsing itself.

## A real technical constraint, checked before choosing a library

Cloudflare Workers have no native `DOMParser`. `fast-xml-parser` was
chosen and confirmed Workers-compatible directly — a real ESM export
path, pure JavaScript, no Node-specific dependencies — not assumed
because it's a well-known library.

## A real finding about the library itself, caught by this bundle's own tests

`fast-xml-parser`'s own `.parse()` is deliberately lenient by design
and does not throw on malformed XML the way a strict validator would
— a first version of this parser's test suite caught an unclosed-tag
document being silently accepted rather than refused. Fixed using the
library's own, separate `XMLValidator.validate()`, confirmed directly
to correctly distinguish well-formed from malformed input before
being relied on.

## Every mapping checked against the real specification, not memory alone

Verified directly against docs.peppol.eu's own Peppol BIS Billing 3.0
documentation. Every core mapping held — `cbc:ID` for `BT-1`,
`DocumentCurrencyCode` for `BT-5`, and, checked precisely against the
spec's own calculation table (section 10.1.1), `LegalMonetaryTotal/
TaxInclusiveAmount` for `BT-112` and `InvoiceLine/LineExtensionAmount`
for `BT-131`.

**A real bug the spec's own worked example exposed**: section 11.1.1
shows a party can legitimately carry more than one `PartyTaxScheme` —
a VAT scheme alongside a separate general tax registration scheme. A
first version of this parser assumed a single element; a real
document shaped exactly like that example would have silently failed
to extract `BT-31`/`BT-48` at all (`array.CompanyID` is `undefined`).
Fixed by finding the entry whose own `TaxScheme/ID` is genuinely
`"VAT"` once there's more than one, proven directly with a test built
from the spec's own example — and deliberately reverted and confirmed
to reproduce the exact silent failure before the fix was restored.

**A real, explicit scope boundary the spec also confirmed**: credit
notes use an entirely different root element (`<CreditNote>`, with
`CreditNoteLine`/`CreditedQuantity` rather than `InvoiceLine`/
`InvoicedQuantity`), not a variant of `<Invoice>`. This parser
correctly refuses a `<CreditNote>` document today rather than
misreading it — stated here as a deliberate boundary, not an implicit
gap.

`BG-20`/`BG-21` (allowances and charges) remain deliberately out of
scope — genuinely complex, repeated, nested groups, not a simple
path-to-scalar mapping. Mapping them approximately would have been
worse than not mapping them at all.

## Two more real bugs, found by this bundle's own tests against the existing capture orchestration

Wiring the parser into `handleCaptureIntake` (decision 0029) surfaced
two genuine gaps in code that already existed, neither specific to
XML:

- **The same "lines" value was being used for two purposes needing
  two different shapes.** `handleUpsertInvoice` needs `amount` as an
  explicit field for storage; `visitCurrentStage` needs raw `BT-*`
  fields directly for evaluation. Passing one canonical, raw-`BT-code`
  line shape to both silently stored every line's `amount` as `NULL`.
  Fixed with a `toStorageLine` mapping applied inside
  `handleCaptureIntake` itself — general, not XML-specific, so the
  same gap in the existing JSON capture path is closed too.
- **A parse failure was never logged as an intake event.** It happens
  before `handleCaptureIntake`'s own rejection logging ever runs, so
  a malformed document was silently dropped from analytics entirely —
  exactly the kind of exception `intake_capture_events` (decision
  0029) exists to make visible. Fixed by logging explicitly at the
  parse-failure site.

Both proven by deliberate revert-and-reproduce, the same discipline
as every other fix in this bundle.

## What's still open

- **PDF and photographed-receipt extraction** — the genuinely harder
  half of document parsing, still requiring real OCR or a vision
  model. Explicitly deferred, matching decision 0026's own reasoning.
- **`BG-20`/`BG-21`** (allowances and charges) — deliberately out of
  scope, named above.
- **Credit note support** (`<CreditNote>`) — a real, separate document
  type, not attempted here.
- **A real invoice number is never used as this system's own id
  directly** — `handleCaptureUblXml` generates a fresh id unless
  explicitly overridden, since two different suppliers could
  coincidentally reuse the same invoice number; decision 0028's own
  duplicate-confidence scoring is what actually detects that
  relationship, not id collision.

## Addendum, 1 September 2026: a real gap found live, fixed

Deployed and proven against real infrastructure: a genuine UBL
invoice, sent as raw XML, correctly parsed every field, correctly
triggered a real, pre-existing rule (`BT-112 > 1000` on the original
`ap-live` process), and correctly spawned a real task — the full
pipeline working end to end for the first time.

Confirming the stored row afterward surfaced a real, genuine gap:
`handleCaptureIntake`'s response never actually returned the invoice's
own `id` — for the JSON capture path this never mattered, since the
caller always supplies `id` themselves, but for `handleCaptureUblXml`'s
auto-generated id, the response gave no way to look the row back up
afterward except by a field like `invoice_number`. Fixed generally,
in `handleCaptureIntake` itself, not just for the XML path: the
response now always echoes back the real `id`, whether caller-supplied
or generated. Proven directly — the fix was deliberately reverted and
the exact gap reproduced before being restored, and a live query
confirmed the returned id matches the id actually stored, not just
that a value is present.

