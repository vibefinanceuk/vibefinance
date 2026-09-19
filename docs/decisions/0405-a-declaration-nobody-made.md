# 0405 — A declaration nobody made

**Status: code built and tested, not yet pushed.**

---

## What was asked

The operator's own report: *"I've noticed that the XML I send in over
email, is received successfully — however, we had previously built an
invoice rendering feature which created a physical invoice that could
be displayed in the viewer. This is not seen for the invoices submitted
today. Do you know if that code still exists and is being triggered?"*

---

## The investigation

Traced the whole path first, before touching anything: `inbound-email.ts`'s
`handleInboundEmail` calls `handleCaptureFromSource`
(`source-capture-route.ts`) for every attachment, which calls
`retainOriginal`, which — whenever the document is detected as plain
XML — calls `renderPeppolDocument` (`peppol-render.ts`) and stores the
result as an `invoice_documents` row (`generated_rendering`), which
`preferredDocumentType` already shows ahead of the raw XML when
present. Every link in that chain is intact; nothing here had
regressed or been disconnected.

A read-only diagnostic against `vf-app-poc` (`facts_json` for
`"render.refused"`, `invoice_documents` by type) told the real story:
**every one of today's four invoices was refused with reason
`not_peppol`, and no invoice in this database has ever once had a
successful `generated_rendering` row — not today, not historically.**
This was never a regression. It has never worked for anything this
system has actually captured.

`renderPeppolDocument` requires `CustomizationID` to contain
`urn:cen.eu:en16931:2017` — OpenPEPPOL's own stylesheet applies the
same guard, and decision 0205's reasoning for copying it was sound:
*"an EN 16931 invoice from another profile would lay out wrongly rather
than usefully."* Checked directly against one of this session's own
test invoice XMLs (`test-invoice-po30008-mismatch.xml`, used earlier
today for the rule-engine verification) — no `CustomizationID` element
at all. Valid UBL, EN 16931 in substance (`AccountingSupplierParty`,
`InvoiceLine`, `LegalMonetaryTotal`, the works), just never formally
declared as Peppol BIS Billing 3.0. That is the shape of every fixture
in this repo and, per the diagnostic, every real captured invoice too.

Put to the operator directly, since it is a product call and not
something to decide unilaterally: keep the strict guard (and treat this
as a data problem — suppliers or the customer's own XML generator
should declare proper Peppol BIS conformance), or render plain UBL
invoices too, on the reasoning that nothing about *this* codebase's own
traversal actually depends on a formal declaration — it reads standard
UBL structure either way. Operator's answer: loosen it.

---

## What was built

### `workers/vf-app/src/peppol-render.ts`

The guard now refuses a **declared** foreign profile, not an
**undeclared** one:

```
const customization = value(root, "CustomizationID") ?? "";
if (customization && !customization.includes("urn:cen.eu:en16931:2017")) {
  return { html: null, reason: "not_peppol" };
}
```

An invoice that names a different profile still refuses — that risk
(this markup misrepresenting a genuinely different profile's own
fields) is real and unchanged. An invoice that names none at all no
longer does; the rest of the function already reads plain UBL
structure regardless of what, if anything, `CustomizationID` says, and
an absent value in the rendered footer is simply a blank line, not a
guessed-at claim.

---

## Tests

`workers/vf-app/test/peppol-render.test.ts` — new describe block
("plain UBL, with no Peppol declaration at all"): a fixture with
`CustomizationID` stripped out entirely renders (`html` non-null,
`reason` null), still shows the real supplier/customer/line content,
and leaves the footer's customization line genuinely blank rather than
fabricating one. The existing "refuses an invoice from another
profile" test (a *different*, explicitly declared URN) is untouched
and still passes — that case is still refused. Fail-first verified
(stashed `peppol-render.ts` alone, confirmed the three new tests failed
with `not_peppol`/null html, restored the fix, confirmed all 34 tests
in the file pass).

`workers/vf-app/test/source-capture.test.ts` — three existing tests
used the same realistic (no-`CustomizationID`) `UBL` fixture and had
encoded the *old*, refused-rendering behaviour as their expectation
(one stored document, not two). Updated to expect both `original` and
`generated_rendering` where the test's actual point survives that
(store count, document-type set), and to filter explicitly by
`document_type = 'original'` where a test's real point was about the
original specifically and an unfiltered, unordered query no longer
reliably named it. No test's actual assertion (UBL content-type, key
shape, the `embedded_xml` negative case) needed to change — only the
document count these three had incidentally baked in.

Full `vf-app` suite: **1950/1950** (1947 + 3 new). `eslint` clean.

---

## What is not built

**No change to what counts as "not an invoice" or "not XML."** Those
two refusals are unaffected — this decision only narrows the third.

**No retroactive rendering of the four already-refused invoices from
today**, or any other already-captured, already-refused document.
`render.refused` facts and the missing `generated_rendering` rows are
historical; nothing here backfills them. Worth a follow-up if the
operator wants today's invoices rendered without waiting for the next
one to arrive.
