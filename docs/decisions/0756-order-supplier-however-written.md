# 0756: An order's supplier, however its seller is written

**Status: live.**

- vf-app:
  - `order-supplier.ts` (new);
  - `goods-receipts.ts`, `grni-route.ts`, `receipt-timeline.ts`, `agent-query.ts`,
    `documents-route.ts`, `po-match-panel-route.ts`, `task-list-route.ts`, `order-checking.ts`,
    `receipt-sharing.ts`.

## What was asked

Found while testing 0755. A supplier kept as "DE 123 456 789" and switched to three-way matching
still showed two-way figures on an order whose seller read "DE123456789". Dan, 13 October 2026,
having been reminded of it: *"yes please - lets fix this"*.

## What was wrong

A purchase order names its seller by `seller_party_id`. This is the supplier's VAT number as the
customer's procurement system writes it, or the supplier's ERP number. Most places that looked
up an order's supplier compared it exactly with `suppliers.vat_id`. So the same number written
with spaces, dots, hyphens or without its country prefix found no supplier, and an ERP number
never did.

The network's sharing (0751, 0739), the order conversation (0752) and Checking (0750) already
matched loosely. The rest did not.

**What that cost:**

- **Goods-receipt figures** (`orderFigures`) took no supplier, so a three-way supplier's orders
  were treated as two-way. The organisation's tolerance was used instead of the supplier's, and
  the receipt checks behind matching used the wrong rule. This fed Purchase Orders, goods
  receipts, and *Still to invoice* and *Invoice this order* in the network (0755).
- **The receipt state** of an order (`receiptStateJoin`) and the tolerance agents use took the
  organisation's.
- **The supplier's name** was blank on the GRNI report (with its ERP number), and in receipt
  emails and Conversations. It was also blank in agents' answers, on Documents' receipts, in
  Tasks' receipt and order rows, and in the PO match panel.
- **Search:** Documents and Goods Receipts did not find receipts by supplier name.
- **The PO match panel:**
  - *This supplier's orders* missed orders whose seller VAT was written differently from the
    invoice's;
  - *Same supplier* said no.

## What changed

One rule, in `order-supplier.ts`, for every lookup of an order's supplier:

- **the VAT number**, with spaces, dots and hyphens dropped. The country prefix is dropped too
  where only one side writes one, so "123456789" is "DE123456789". Two numbers that both name
  their country must name the same one: "GB1" is never "DE1". The first draft dropped the prefix
  always, and the agents' purchase-order test caught Kingsway (GB1) answering for Lager Nord
  (DE1);
- **or the ERP number**, exactly;
- **an active supplier first**, then by name, where more than one answers.

`SAME_VAT_SQL` compares two VAT numbers, `SUPPLIER_IS_SELLER` is the condition for a supplier,
and `ORDER_SUPPLIER_SQL` is the subquery for one of the supplier's columns. `sameVat` compares
two VAT numbers in code. Every place listed above now uses
them.

The VAT helpers (`bareVat`, `BARE_SQL`) moved into the same module, which depends on nothing, so
any module can use them at load time. `receipt-sharing.ts` re-exports them as before.

`BARE_SQL` now drops hyphens too, as `bareVat` always did. Checking's own copy of the rule is
replaced by the shared one.

Invoices are untouched: an invoice's supplier is still found as it was.

**Left as it was:** the network's own sharing of receipts and orders with a supplier (0739, 0751)
still drops the prefix always. Bringing it onto this rule is a separate change.

## Tests

- **vf-app** `order-supplier.test.ts`, 7 tests:
  - VAT numbers compared however written, and different numbers or countries not;
  - an order whose seller is "DE123456789", "de 123 456 789", "123456789", "DE-123-456-789" or the
    ERP number finds the active supplier, three-way with its tolerance. This holds in the figures,
    in the shared subquery, and in Checking;
  - another number or another country's finds nobody, and an ERP number is matched exactly.
- **`order-sharing.test.ts`:** the three-way test (0755) no longer rewrites the supplier's VAT
  number to make it match.
- Related suites pass (46 files, 701 tests): orders, receipts, PO matching and the match panel,
  GRNI, agents, Documents,
  Tasks, credit notes, network and portal.

## To deploy

No migration. Deploy vf-app.
