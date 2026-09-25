# 0482 — Seller Card: VAT, Address, and Postcode Never Populated

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Reported live: *"The seller VAT no, or the address and postcode are
never populated in the supplier card. Even if the information exists
in the database for that supplier. the buyer card seems okay. Can you
investigate."*

## What was found

**A real, long-standing bug in `handleGetInvoice`** (`invoice-facts-route.ts`),
predating this session by two weeks (last touched 11 September, before
any of this session's own decisions). `matchedSupplier` is loaded with
a plain SQL `SELECT`, so D1 hands it back under its own column names —
`vat_id`, `address_line`, `postal_code`, `erp_identifier`,
`erp_site_identifier`, `is_pay_site`, `on_hold`, `hold_reason`. The
response then did `supplier: { ...matchedSupplier, countryName }` —
spreading that raw, snake_case row straight into the API response.
`sellerPanel()` (`viewer.js`) has always read it as camelCase —
`s.vatId`, `s.addressLine`, `s.postalCode`, `s.erpIdentifier`,
`s.isPaySite`, `s.onHold`, `s.holdReason` — because that is the
contract `buyer` a few lines above has always honoured, mapping every
field explicitly (`vatId: buyerEntity?.vat_id ?? null`, and so on).
`supplier` never had the same treatment.

**`city` and `country` are single words, so they happened to work
regardless of case** — which is exactly why the bug read as "VAT,
address, and postcode are missing, but the buyer card is fine": the
buyer path was never broken, and the seller path's coincidentally-matching
fields masked how broadly wrong the rest of it was. Every other
camelCase field on the matched-supplier branch was silently wrong too
— the ERP identifier/site sub-line, the "pay site" tag, and the
on-hold warning banner (`s.onHold`) all depend on fields with the same
mismatch, though none of those were reported (a held or ERP-tagged
supplier evidently was not tested against live data in this pass).

**The existing tests had enshrined the bug as the contract.**
`test/load-suppliers.test.ts` had three assertions reading
`supplier.erp_site_identifier`, `supplier.is_pay_site`,
`supplier.on_hold`, and `supplier.hold_reason` — the raw, wrong shape,
asserted as if it were correct. That is exactly why this went uncaught
by the test suite: nothing ever checked the field the frontend
actually reads. The frontend's own browser tests (`viewer.test.ts`)
never caught it either, for a different reason — they hand-author
camelCase mock JSON for `/api/invoices/:id`, which was always the
*intended* shape, so they verify `sellerPanel()`'s own rendering logic
correctly but say nothing about what the real backend route actually
returns.

## What was decided

**Map every field explicitly, the same way `buyer` already does —
not fix the symptom by adding two keys.** A partial fix (adding
`vatId`/`addressLine`/`postalCode` onto the spread) would have left
every other camelCase field on this object equally wrong, just less
visibly so. `supplier` now gets the identical field-by-field
`snake_case ?? null` → `camelCase` treatment `buyer` has always had,
covering every field `sellerPanel()` reads: `erpIdentifier`,
`erpSiteIdentifier`, `name`, `vatId`, `electronicAddress`, `email`,
`phone`, `addressLine`, `city`, `postalCode`, `country`, `isPaySite`,
`isProcurementSite`, `onHold`, `holdReason`, `paymentTerms`, plus the
existing `countryName`.

## What was built

- **`workers/vf-app/src/invoice-facts-route.ts`**: the `supplier:`
  branch of `handleGetInvoice`'s response rewritten from
  `{ ...matchedSupplier, countryName }` to an explicit field-by-field
  map, as above.
- **`workers/vf-app/test/load-suppliers.test.ts`**: the three
  pre-existing tests that asserted the wrong, snake_case shape
  (`erp_site_identifier`, `is_pay_site`, `on_hold`, `hold_reason`)
  corrected to assert the camelCase names the frontend actually reads.
  The first of the three extended with direct assertions on
  `vatId`/`addressLine`/`postalCode` — the exact fields reported
  missing — so the regression this decision fixes has a test that
  would have caught it.

## What was not built

No frontend change — `viewer.js` was already reading the correct
field names throughout; this was purely a backend response-shape bug.
No change to `openSupplierSearch()`'s own search-result rendering or
`load-suppliers.ts`'s `/api/suppliers/search` route, both of which
already map their own fields to camelCase correctly and were never
affected.

## Verification

`workers/vf-app/test/load-suppliers.test.ts`, `test/key-fields.test.ts`,
`test/invoice-facts-route.test.ts` together: **219/219**. Batch run
across every file touching `invoice-facts-route.ts`
(`dashboard.test.ts`, `documents.test.ts`, `fraud-duplicates.test.ts`,
`invoice-facts-route.test.ts`, `invoice-history.test.ts`,
`key-fields.test.ts`, `load-suppliers.test.ts`): **376/376**. `tsc
--noEmit` shows no new errors in `src/invoice-facts-route.ts` (only
the same pre-existing `cloudflare:test` noise already documented
throughout this session).

## Still to do, operator side

Push and deploy `vf-app` only — no `vf-ui`/`vf-licence` change, no new
migration, no new string. Once live, worth checking a held or
ERP-tagged supplier's own invoice too — the on-hold banner and the
ERP/site sub-line were silently affected by the same bug and are fixed
by the same change, though neither was part of what was reported.
