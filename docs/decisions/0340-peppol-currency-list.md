# 0340 — The Full Peppol BIS Billing 3.0 Currency List

**Status: built.** "We should have a table of valid peppol biz 3.0
currencies." Directly corrects decision 0339's own stated guess — a
four-currency list (CHF, EUR, GBP, USD) explicitly flagged there as
"a real, stated assumption, not a researched requirement." This is
the researched requirement.

---

## What Peppol actually requires

Checked directly rather than assumed: Peppol's own specification
states plainly that "all currencies in an invoice or credit note
shall be the alphabetic code from ISO 4217." There is no narrower,
Peppol-specific currency subset separate from ISO 4217 itself — the
same standard this project's own BT-5 field already points to
(decision 0112), and the same page
(`docs.peppol.eu/poacc/billing/3.0/codelist/ISO4217/`) that field's
own documentation already references.

**Fetched, not retyped from memory.** The full, current list —
178 codes, from Peppol's own May 2026 release — was pulled directly
from that page rather than reconstructed from training data, since a
hand-copied list this long is exactly where a memory error would
hide unnoticed. Counted and spot-checked against the source directly
before use.

## What changed

`APPROVAL_AND_SPEND_CURRENCIES` (four codes) replaced by
`PEPPOL_CURRENCIES` (178, code and name together) in `access.js`.
`currencyPicker` now shows each option as `code — name` rather than
the bare code alone — most of this list is currencies nobody
administering this system has ever had reason to recognize by code
alone, and a bare three-letter list of 178 entries would be close to
unusable. The function's own shape, and every place it is called
(both approval and spend limit, on both the Properties pop-out and
the New Person form), are unchanged from decision 0339 — only the
data it draws from grew from a guess to the real list.

## What has coverage

Both of decision 0339's own tests, which asserted the exact four-code
list, updated to check the real one: 178 options, alphabetically
ordered, containing the currencies this project's own examples
already use, each labelled with its own name — checked by count and
representative membership rather than writing all 178 values out a
second time in the test itself. Probed directly: truncating the
picker to a single option failed exactly the test built to catch it.

`vf-app`: unchanged (frontend-only). `vf-ui`: 63 Worker (unchanged),
498 browser (unchanged in count — two tests replaced, not added).
