# 0113 — The standard's own code lists

**Status: built** — the lists, and the keying screen's pickers. **Not
built:** closed-value enforcement in the compiler, and validation of
extracted codes.

---

## What was wrong

Currency and unit of measure were **free text**. Somebody keying an
invoice could type `EUR`, `eur` or `EURO`, and only the first is a valid
ISO 4217 code.

And the same problem has a second face, already recorded in
`PROGRESS.md` as proposed and unbuilt: **closed-value enforcement**. A
rule saying *"currency is EURO"* compiles, activates, fires against
nothing, and looks correct in every listing.

One list fixes both.

---

## Not configuration, and the reason is a line

Decision 0107 put the interface's **words** in D1 so a wording fix needs
no deployment. That was right *because those words are ours to change*.

A code list is not. The operator's statement, which settles it:

> If we are saying that the standard code lists are our baseline, then
> they should never need customer specific configuration.

ISO 4217 is the standard. Editing it would make a document
non-conformant, a customer must never be able to, and it does not vary
between them — so putting it in D1 would mean seeding 178 identical rows
per customer database.

**The line that falls out:** `ui_strings` is what *we* call things; a
code list is what *the standard* calls things. The first is ours, the
second is not.

So they sit in `shared/standards/`, beside the vocabulary.

---

## Transcribed from Peppol, not from ISO

`docs.peppol.eu/poacc/billing/3.0/codelist/` publishes exactly what BIS
Billing 3.0 accepts. **A general ISO source would be the wrong list** —
Peppol's own subset is what a document is validated against.

Each list records its **agency and version**: `ISO`, `2018-01-01`.
*"Which ISO 4217"* is a real question when a currency is added or
withdrawn, and a list without a version cannot answer it.

| Field | List | Codes |
| --- | --- | --- |
| BT-5 currency | ISO 4217 | 178 |
| BT-130 unit of measure | UN/ECE Rec 20 | 24 **of hundreds** |
| BT-151 VAT category | UNCL5305 | 9 |

---

## One of these is a subset, and says so

Recommendation 20 runs to hundreds of codes, from becquerels to
bushels. **Offering all of them makes finding `C62` harder, not
easier**, and somebody keying a freight invoice needs a dozen.

So `UNECERec20` carries the ones in ordinary use — and `isClosedList`
returns **false** for it, deliberately.

The difference matters and is not cosmetic: **a value outside a closed
list is non-conformant; a value outside a working subset is merely
unfamiliar.** Validation must refuse the first and accept the second, or
it will reject valid documents for using a unit nobody anticipated.

Watched to fail: treating the subset as closed breaks the test that says
it is not.

---

## What the picker does that a text box cannot

**An empty option, first.** A field the document did not supply stays
unset rather than silently acquiring the first code alphabetically.
*Absent* and *AED* are very different claims about an invoice.

**Code and name together** — `C62 · One (unit)`. A dropdown of bare
codes is one nobody can use.

**And an unfamiliar value is kept, not dropped.** If a document carried
a code the list does not know, the picker shows it as
`XYZ · not in ISO4217` rather than resetting the field. Losing what a
supplier actually sent would be worse than displaying something odd.

The lists load **before** the viewer renders, so a field never appears
as a text box and turns into a picker under somebody's hands.

---

## Only where the standard closes the value

`FIELD_CODE_LISTS` maps three fields. A field absent from it is free
text **by the specification's own design**, and adding one would invent
a restriction Peppol does not make.

A test asserts every mapped field is one the vocabulary declares — the
same class of gap `field-coverage.test.ts` guards from the other
direction.

---

## What is not built

- **Closed-value enforcement in the compiler.** The list now exists;
  `validateRule` does not consult it. A rule naming `EURO` still
  compiles.
- **Validation of extracted codes.** A supplier's UBL carrying
  `currencyID="EURO"` is non-conformant and is stored happily today.
  **This is the more valuable half** — a dropdown stops a person
  entering a bad code, validation stops a document carrying one.
- **The other lists BIS defines**: UNCL1001 invoice type, UNCL4461
  payment means, UNCL5189 and UNCL7161 allowance and charge reasons,
  ISO 3166 country, and the IANA mime subset. Real, and none is on a
  screen yet.
