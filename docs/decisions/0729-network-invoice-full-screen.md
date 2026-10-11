# 0729: An invoice in the network opens full screen, laid out as Create

**Status: live** at `b17099d`, pushed and deployed 11 October 2026. vf-app (`portal-route.ts`, `network-submission.ts`),
vf-portal (`view.js`, `portal.js`, `portal.css`), vf-licence (strings migration 0333).

## What was asked

Dan, 11 October 2026: *"the invoice pop-out, instead of being a pop-out, opening in full screen
mode. With a UI that is similar to the Create invoice screen, in terms of layout. With one
exception and that would be there would be a panel on the right, showing the Supplier - Customer
messages."* On the mock-up: *"looks good - could you extend the line items card across the full
width of the page. And then align the message box with the bottom of the invoice header card."*

## What changed

- **Full screen, in place of the list.** Opening a row on Documents shows the invoice in the page;
  Documents stays chosen in the side menu. **Documents** in the top bar goes back to the list
  (refreshed); **Download** saves what is shown as a CSV file (header, then a row per line).
- **Laid out as Create, read only.** The customer's comment when returned or rejected; Seller,
  Buyer and Payment (status, due date, terms, pay into); the Invoice header in Create's five
  columns (number, currency, dates, PO, buyer reference, net, VAT, total, received).
- **Messages on the right**, 380px, its top level with the cards and its bottom level with the
  Invoice header; the messages scroll inside it, the latest in view, the reply box at its foot.
  (`contain: size` leaves the row's height to the cards.) Under 1000px wide it stacks below.
- **Lines across the whole page** below, with net, VAT and total.
- **vf-app** `GET /portal/invoices/:id` also answers the due date, buyer reference, payment terms,
  net, VAT and amount due as read (BT-9, BT-10, BT-20, BT-109/106, BT-110, BT-115), and the seller
  and buyer as the customer keeps them — the same `partiesFor` Create uses (0727), now exported.
- Opening still reads the invoice's messages (0728): its pill and the menu's count go down.

## Tests

vf-app `supplier-messages.test.ts`: an opened invoice carries its dates, references, amounts and
parties. vf-portal: `view.js` is served; its words are defined in English and German. Checked in
Chromium, Day and Night at 1600px and stacked at 800px: the messages panel ends exactly level
with the Invoice header; back to Documents works.

## To deploy

Migration: vf-licence `0333_network_invoice_view_strings.sql`. Deploy vf-app, vf-licence and
vf-portal.
