# 0389 — The country stays a code

**Status: built.** Supersedes decision 0221 in part.

---

## What was asked

> I wondered if you could not replace the 2 digit country code, with
> the expanded Peppol long form version. This is well illustrated with
> GB, becoming "United Kingdom of Great Britain and Northern Ireland".
> I think in all cases, we can stick with the short form country code.
> Both within the Seller and Buyer cards. Please confirm if possible -
> thank you

---

## The premise, checked before building anything

Decision 0221 chose the expanded name on purpose — *"an invoice prints
*United Kingdom*; our record holds `GB`. A card that exists to be
compared against an image should say what the image says."* That
reasoning does not survive contact with a code like `GB` expanding to
**"United Kingdom of Great Britain and Northern Ireland"**: OpenPEPPOL's
own list gives the *legal* long form, not the short form an invoice
actually prints, so the card was saying something a supplier's own
document never says either.

`countryName` is computed in exactly one place per party, in
`invoice-facts-route.ts` — `CODE_LISTS.iso3166?.[code]?.en ?? code` —
strictly *derived from* `country`, checked before relying on it: there
is no case where `countryName` is present and `country` is not, so
reading `country` alone loses no data.

---

## What was built

**`viewer.js`.** `addressBlock(party, label)` — the one function both
`sellerPanel()` and `buyerPanel()` call to build the address lines —
had `party.countryName ?? party.country` in its `lines` array. Changed
to read `party.country` alone. One shared function, so both cards are
fixed by the one edit, as asked.

---

## Tests

`viewer.test.ts`, three edits:

- Two existing fixtures that set `countryName: "United Kingdom..."` to
  make the card show something readable — one in the decision-0227
  "name once" test, one in the decision-0387 "address beside its
  label" test — were changed to set `country: "GB"` instead, and the
  0387 test's own assertion changed from expecting the long name to
  expecting `"GB"`.
- A new, dedicated test: a stubbed invoice record carrying **both**
  `country: "GB"` and `countryName: "United Kingdom of Great Britain
  and Northern Ireland"` on both `supplier` and `buyer` — the same
  shape the real backend still sends — asserts the rendered page
  contains `"GB"` and does not contain the long name, on either card.
  Watched fail first: reverting `viewer.js` with `git stash` while
  keeping the test, `countryName` (the longer string) wins the `??`
  and the test fails exactly as expected; restoring the fix, it
  passes.

Full suite: 74 Worker, 666 browser (663 unchanged, 3 changed/added as
above), all passing. `eslint` clean. No migration — markup only.

---

## What is not built

`invoice-facts-route.ts` still computes and sends `countryName` for
both `supplier` and `buyer` — left in place as unused, harmless data
rather than removed, the same way decision 0387 left `electronicAddress`
/ `email` / `phone` fetched-but-unread once their rows came off the
card. `countryName` was, before this change, read in exactly one place
in the whole frontend (`addressBlock()`, just fixed) and is read
nowhere else — checked with `grep` across both Workers' source and test
suites, not assumed.
