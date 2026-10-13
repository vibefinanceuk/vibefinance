# 0761: The order PDF shows its tax and who to talk to

**Status: live.**

- vf-app: `order-pdf.ts`, `orders-out.ts`.

## What was asked

Dan emailed in a new order, 690000314, after 0760 went live, and attached its PDF. Reading it
back, two things fell short, and Dan asked for both to be fixed:

- **The totals did not add up on the page.** It went from Net £399.20 to Total £479.04 with no tax
  line between them. The totals block showed the totals excluding and including tax only where they
  differed from Net and Total, and never the tax itself.
- **The Buyer block said only "Acme Group".** An emailed-in order names no buyer, so the supplier
  had nobody to ask.

## What changed

### The totals

- The tax now has its own line, **VAT** (*MwSt.* in German), between Net and Total.
- It is the order's total including tax less its total excluding tax.
- An order that gives neither of those is taken to have, as its tax, whatever lies between its net
  and its total. A Peppol order's only other amounts are allowances and charges, which our orders
  do not carry.
- The totals excluding and including tax are still shown where they differ from Net and Total.

### The Buyer block

It shows the company first, then who to talk to:

1. **The order's buyer**, where one is set: *Contact: Pat Lee* and their email.
2. **Otherwise, the Orders to suppliers Destination's reply-to mailbox**, the same address the
   email's replies go to.
3. **The company's own email and phone** (0053), where set, and where its email is not the same
   address again.

This is the same in the email's attachment and in the Document tab. The Document tab now reads the
Destination's reply-to for this.

### Left as it is

The supplier's VAT number prints as the supplier record holds it. 690000314's has no GB prefix
because its supplier load gave none.

## Tests

- **vf-app** `order-pdf.test.ts`, one more test:
  - tax totals give *Net / VAT / Total*, with neither of the excluding and including lines;
  - an order with no buyer shows the reply-to mailbox, the company's email and its phone;
  - with a buyer: *Ansprechpartner: Pat Lee* and their email in German, the reply-to dropped, and
    *MwSt.*;
  - an order with no tax totals shows the difference as VAT.
- **Related suites pass:** vf-app order PDF, orders out and network sharing (3 files, 28 tests).
- **A sample PDF** was rendered and checked by eye.

## To deploy

No migrations. Deploy vf-app.
