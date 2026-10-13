# 0751: Purchase orders shared with suppliers in the network

**Status: live.**

- vf-app: migration 0168, `order-sharing.ts` (new), `receipt-sharing.ts`, `portal-route.ts`,
  `purchase-order-route.ts`, `index.ts`.
- vf-portal: `src/network.ts`, `src/index.ts`, `public/portal.js`, `public/order-view.js` (new),
  `public/shell.js`, `public/portal.css`.
- vf-ui: `receipt-sharing.js`, `suppliers.js`, and the proxy.
- vf-licence: strings migration 0349.

## What was asked

Slice 3 of the purchase orders proposal (0749). Dan, 12 October 2026: *"Yes, please start slice
3"*, after:

> Slice 3 is next: sharing purchase orders with suppliers in the network, the same way goods
> receipts are shared.

It is the first part of the earlier proposal for orders in the network:

> Sharing: orders are shared the way receipts are. There would be an AP Setup switch under
> Supplier network, a per-supplier override, and a choice between all orders or only those
> issued from a given date. … In the network's Documents: orders sit among invoices and
> receipts, labelled "Purchase order". … Opened: a full page laid out like the receipt page.

## What changed

### Whether a supplier sees its orders (as receipts, 0738)

- **AP Setup › Supplier Network** asks it beside goods receipts: **Don't share** (the default)
  or **Share with suppliers**. It also takes **Only orders issued on or after** a date; left
  empty, every order is shared. It says how many suppliers have their own setting for orders.
  - `network_sharing_config` gains `share_orders` and `orders_from`.
  - `GET /network-sharing-config` adds them, and `suppliersWithOwnOrders`.
  - `PUT` takes `shareOrders` and `ordersFrom` (YYYY-MM-DD, or empty for every order). Anything
    else is refused with `orders_from_invalid`. Receipts' settings are untouched by it, and the
    other way round.
- **A supplier's own page**, on its Supplier portal card, beneath its goods receipts setting:
  **As AP Setup**, **Share with this supplier**, or **Don't share with this supplier**. The
  supplier's setting wins.
  - It is held in `supplier_order_sharing`.
  - `GET|PUT /suppliers/:id/order-sharing` is read with AP.Supplier and changed with
    Supplier.Maintain, as receipts' is.
- **Which orders are a supplier's:**
  - those whose seller is the supplier, by its VAT number however written, or its ERP number;
  - placed by a company the supplier's person is linked for, or one beneath it;
  - issued on or after AP Setup's date, where it gives one.

  Only orders in force are shown. An order still being checked (0750) never is.

### In the network

- **Documents** lists shared orders among invoices, credit notes and receipts, newest first,
  typed **Purchase order**. Each shows its number, issue date, total in its own currency, and
  company.
- **Its status** is one the supplier can act on, worked out in this order:
  1. **On hold** or **Closed**, closed covering cancelled (0750);
  2. else **Invoiced** or **Part invoiced** (0377's invoiced amounts);
  3. else **Received** or **Part received** (0646's receipt state, net of returns, registered
     receipts only);
  4. else **Open**.
- The type and status filters offer orders once any customer shares them, as for receipts.
  Search finds an order by its number, or by an item's name or the supplier's item number.
  Help explains each status.
- **Opened**, read only, on its own page in the frame, laid out as a receipt's. It shows:
  - customer, company, order date, currency and total;
  - per line: the item, *your item number*, quantity ordered and unit, price, amount,
    **received** (net of returns), **invoiced**, and **still to deliver**.

  An order has no conversation yet, so it takes the whole width. It never shows why an order
  is on hold, who bought it, or its coding.
- Endpoints:
  - `GET /portal/orders/:id` (portal token, scoped as receipts are) gives the same 404 for one
    that does not exist, is another supplier's, or is outside its companies;
  - `/portal/invoices` merges orders in and says `orders: true|false`;
  - vf-portal asks `GET /api/orders/:linkId/:id` of the customer that link is for.

### Words (vf-licence 0349)

49 keys, in English and German.

## Not in this

- A conversation about an order (Ask supplier, Query raised, Conversations), as receipts have
  (0740, 0748). The page leaves room for it.
- Emailing suppliers their orders (slice 4); invoicing from an order (slice 5).

## Tests

- **vf-app** `order-sharing.test.ts`, 7 tests:
  - not shared until AP Setup or the supplier says so, the supplier winning;
  - the date kept and a bad one refused;
  - receipts' and orders' settings independent;
  - nothing listed until shared;
  - a supplier's orders for its companies and those beneath, by VAT written with spaces and by
    ERP number, and another supplier seeing only its own;
  - the date, search by number and item, and the status filter;
  - an order opened with received (net of a return) and invoiced per line, never its hold
    reason, and the same 404 for none, another's and another company's;
  - the status order;
  - the supplier's own setting through the router: AP.Supplier reads, Supplier.Maintain
    changes.
- **vf-app** `receipt-sharing.test.ts`: AP Setup's answer now carries orders' settings,
  untouched.
- **vf-portal**:
  - `network.test.ts`: whether any customer shares orders, opening one from its link's
    customer, 404 for another's link, 401 when signed out;
  - the network's words cover the order page and the order statuses, in English and German.
- **vf-ui browser** `receipt-sharing.test.ts`: AP Setup's orders question saves the choice and
  date; the supplier's order setting saves to its own address.
- **vf-ui worker**: the proxy passes `/suppliers/:id/order-sharing`.
- **vf-licence** string coverage.
- The full vf-ui browser suite passes except the known `typography.test.ts` 10px gap.
- **Screenshots:** Documents with orders among the rest, and an order opened, in Day and Night.

## To deploy

Migrations: vf-app `0168_order_sharing.sql`, vf-licence `0349_order_sharing_strings.sql`.
Deploy vf-app, vf-licence, vf-ui and vf-portal. Then turn it on: AP Setup › Supplier Network ›
Purchase orders › Share with suppliers.
