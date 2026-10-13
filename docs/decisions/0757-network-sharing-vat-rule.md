# 0757: The supplier network shares by the one VAT rule

**Status: built.**

- vf-app: `order-sharing.ts`, `receipt-sharing.ts`, `order-messages.ts`, `receipt-messages.ts`.

## What was asked

Left open by 0756: the supplier network's sharing still dropped a VAT number's country prefix
always. A British supplier whose number had the same digits as a German one's (GB123456789,
DE123456789) was treated as the same supplier. Dan, 13 October 2026: *"Please can you work on
Supplier network sharing."*

## What changed

The four places the network decides whose order or receipt something is now use 0756's rule,
`SUPPLIER_IS_SELLER`:

- **Which orders a supplier sees** (`order-sharing.ts`, 0751): in Documents, opened, and written
  about.
- **Which receipts a supplier sees** (`receipt-sharing.ts`, 0738).
- **Who an order's conversation is with** (`order-messages.ts`, 0752): who at the supplier is
  told, and who may reply.
- **Who a receipt's conversation is with** (`receipt-messages.ts`, 0740).

**The rule:**
- the VAT number with spaces, dots and hyphens dropped;
- the country prefix dropped only where one side leaves it off, so "123456789" is still
  "DE123456789" but "GB123456789" is not;
- or the ERP number, exactly.

A supplier sees an order when its own record answers for the order's seller by that rule.

The local copies of the old comparison in `receipt-messages.ts` are gone. The helpers now live
only in `order-supplier.ts`.

**Left as it was:** a credit note finding the invoice it credits (`credit-notes.ts`, 0731) still
compares VAT numbers with the prefix always dropped. It works among one supplier's invoices, so
the risk is small, but bringing it onto this rule would be a separate change.

## Tests

- **vf-app** `order-sharing.test.ts`: a supplier with GB123456789 sees only orders whose seller is
  "GB 123-456-789" or "123 456 789". It never sees Lager Nord's DE123456789 orders, and gets a
  404 on opening one. An order's conversation is with the supplier of that very number.
- **`receipt-sharing.test.ts`:** the British supplier sees none of Lager Nord's receipts.
- Both fail on the previous rule.
- Related suites pass (26 files, 405 tests): orders, receipts, portal, network, supplier
  messages, credit notes, PO
  matching.

## To deploy

No migration. Deploy vf-app.
