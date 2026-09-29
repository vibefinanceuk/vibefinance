# 0560 — Routes phase 2, slice 1: structured formats in, with EN 16931 checks

**Status: built and tested locally, not yet pushed or deployed.** This
session cannot push, so the work is delivered as a git bundle. It touches
`shared`, `vf-app`, `vf-ui` and `vf-licence`. It needs two migrations:
**`vf-app` `0110`**, applied before `vf-app` is deployed, and
**`vf-licence` `0211`**.

## What was asked

Phase 2 of the Routes design is "structured formats in, plus the mapping
editor". Its first slice is to receive every EN 16931 syntax as data:
UBL, CII, XRechnung and ZUGFeRD / Factur-X. Each is checked against
EN 16931 when it arrives, and the Routes screen shows the formats a route
receives, as in the phase 2 mock-ups Dan approved.

On 29 September 2026 Dan agreed that the EN 16931 business rules are
checked in our own code, with the official rules used as the yardstick in
tests: "yes for checking EN16931 business rules, please feel free".

## What was found first

**Every real Factur-X and ZUGFeRD PDF was refused.** Their embedded XML
is always CII. The hybrid-PDF path (0042) passed that XML to the UBL
parser, which refused it because the document had no `<Invoice>` root.

That path's tests passed only because every fixture embedded UBL, which
no real Factur-X does. XRechnung written in CII was refused in the same
way. Only UBL was ever read as data.

## What was decided

### Reading every syntax

**One entry point for an XML invoice** is `readInvoiceXml`, in
`shared/ingestion/invoice-xml.ts`. It recognises the syntax from the root
element:

- `<Invoice>` is UBL;
- `<CrossIndustryInvoice>` is CII;
- `<CreditNote>`, and a CII document with a credit note type code, are
  refused in words: "credit notes are not read yet";
- ZUGFeRD 1.0 (`<CrossIndustryDocument>`) is refused, because it predates
  EN 16931.

Everything that has XML in hand now goes through it: a bare XML
attachment, the XML inside a PDF, and `/capture-xml`.

**A CII parser** is in `cii-parser.ts`. It reads the same Business Terms
the UBL parser reads, from their places in the EN 16931-3-3 CII binding.
An invoice's facts do not depend on the syntax it arrived in.

- Dates written as `udt:DateTimeString` in format 102 become ISO dates.
- Only the tax registration with `schemeID="VA"` is read as the VAT
  identifier. `FC` is a tax number, not a VAT number.
- BT-110 is taken in the invoice currency, as the UBL parser does.

### Recognising the format

The format is recognised from what the document declares in BT-24, its
specification identifier (`invoice-format.ts`). The list of formats is
closed:

- `peppol_bis_3`
- `xrechnung`
- `en16931`
- `factur_x_extended`, `factur_x_basic`, `factur_x_basic_wl`,
  `factur_x_minimum`
- `ubl_other` and `cii_other`, for a UBL or CII invoice that declares
  something else.

Factur-X MINIMUM and BASIC WL are recognised and **not checked**. They
carry no lines, are not EN 16931 invoices, and would fail every check.

### The EN 16931 checks

The rules are in `en16931-rules.ts`, each named by its official
identifier:

| Group | Rules |
|---|---|
| Presence, whole invoice | BR-01 to BR-16 |
| Presence, each line | BR-21 to BR-26 |
| Line price not negative | BR-27 |
| Country prefix on VAT identifiers | BR-CO-9 |
| Arithmetic | BR-CO-10, BR-CO-13, BR-CO-15, BR-CO-16 |
| Due date or payment terms when an amount is due | BR-CO-25 |
| Buyer reference, XRechnung only | BR-DE-15 |

A failed check records the figures it found, for example "BT-115 700.00,
expected 649.74". The rules not checked are listed in the code as
`EN16931_RULES_NOT_CHECKED`:

- the VAT breakdown rules;
- allowances and charges;
- code lists;
- the other BR-DE rules.

**A failure never stops an invoice.** The invoice is delivered, and the
rules it broke are recorded as facts: `intake.format`, `en16931.checked`
and `en16931.failures`. These are in the closed vocabulary, so a
customer's rule can route such invoices, for example `en16931.failures
contains BR-CO-16`.

### Where the results appear

- **On the message part.** Migration `0110` adds `format`, `syntax` and
  `en16931_failed` to `route_message_parts`. A message with a broken rule
  also gets an `en16931_failed` event in its history.
- **In the Route monitor.** Each attachment read as data shows its format
  and syntax, and either "Passed EN 16931", "Not checked", or each rule
  it broke, in words and with the figures found. It also says that the
  invoice was still delivered.
- **On the Routes screen.** A Source route that detects formats now has a
  **Receiving formats** panel. It lists each format in the order it is
  tried, how it is read, and what it is checked against. It gives the
  last 30 days' attachments, how many broke a rule, and how many could
  not be read at all. Anything read from inside a PDF counts as
  ZUGFeRD / Factur-X, whatever profile it declares.

### Also fixed

A UBL party with a single `PartyTaxScheme` whose `TaxScheme/ID` is present
and is not `VAT` is no longer read as the VAT identifier (BT-31 or BT-48).
Before this, a German Steuernummer was read as a VAT number: it failed
BR-CO-9 and matched no supplier. The XRechnung test suite found this.

Strings for the new screens are in English and German (`vf-licence`
`0211`), including every checked rule in words.

## Not built

- **Credit notes.** They are refused in words, as before. Reading one is
  a workflow question: a credit note offsets invoices and is not paid.
  It needs its own slice.
- **A readable rendering of a CII invoice.** The generated rendering
  (0205) is for UBL only. A bare CII invoice shows as XML, and a
  Factur-X shows its PDF.
- **Checks for BT-40 and the other code lists** against ISO lists.
  BR-CO-9 checks that the prefix is two capital letters, not that they
  name a country.
- **SFTP and API Sources.** These are phase 2 as well, but separate from
  reading formats.

## The yardstick: official test material

The official test material is not copied into this repository. The CEN
artefacts are EUPL 1.2, and vendoring them would bring that licence with
them.

`shared/ingestion/en16931-conformance.test.ts` reads local clones named by
`EN16931_ARTEFACTS` and `XRECHNUNG_TESTSUITE`, and is skipped where there
are none.

In this session:

- **CEN's per-rule UBL unit tests.** Every case for every rule we check
  passed: our rule fails exactly where the official test expects an
  error, and not where it expects success. There are no official unit
  tests for BR-CO-9 or BR-CO-25, so ours cover them.
- **CEN's example invoices.** All UBL and CII examples read, and pass
  every rule we check.
- **KoSIT's XRechnung test suite.** All 86 instances, 45 UBL and 41 CII,
  read as `xrechnung`. 85 pass every rule. The one exception,
  `05.01a-INVOICE_ubl.xml`, gives an amount due of 366.86 against a total
  of 336.90, with no amount paid or rounding. We report BR-CO-16 for it,
  which is correct.
- **CII against UBL.** The paired CEN examples (UBL example n and CII
  example n) were compared. Every remaining difference is a difference in
  the source documents, not in the parsers.

Where our results and the official tests first disagreed, we changed our
code rather than the tests:

- An empty `<PostalAddress/>` counts as present (BR-08 and BR-10).
- Two tax totals in the same currency are added together for BR-CO-15.

## Verification

- **`shared`**:
  - `invoice-xml.test.ts`, 27 tests: CII facts; the VAT number and not
    the tax number; BT-110 with an accounting currency; BR-DE-15 only on
    XRechnung; MINIMUM not checked; each refusal; root detection; format
    identification; BR-CO-9 and BR-CO-25.
  - With the official material, 282 tests pass. Without it, the suite
    passes with the conformance file skipped.
  - Three `shared` failures existed before this change and are
    unchanged: two licence-token verifications and the table
    classification list.
- **`vf-app`** `structured-formats.test.ts`, 7 tests, which fail against
  the old code:
  - an XRechnung in CII by email;
  - the CII inside a real Factur-X PDF (a new fixture, built by
    `scripts/build-pdf-fixtures.py`);
  - an invoice breaking BR-CO-16, delivered, with the event recorded;
  - a credit note refused in words;
  - the monitor's part detail;
  - the Routes list's 30-day counts;
  - CII through `/capture-xml`.
- **`vf-app`** full, unfiltered run: 140 files and 3278 tests, of which
  **3276 passed**. The two failures are the ones already known (0511).
- **`vf-ui`**:
  - browser `routes.test.ts`: the formats panel, with real strings, and
    its absence for a Destination;
  - browser `route-monitor.test.ts`: the checks passed, broken and not
    checked, and nothing shown for a message with no e-invoice.
  - These five tests fail against the old UI.
  - Worker tests: 75 of 75. Browser tests: 1337 of 1338, the one failure
    being the known `typography.test.ts` 10px gap.
- **`vf-licence`**: 322 of 322.
- **Migrations**: `vf-app` replays 110; `vf-licence` replays 211.
- **Screenshots**, checked by eye: the Receiving formats panel and the
  monitor's checks, Day and Night.
