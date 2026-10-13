# 0753: A purchase order opened as a page, the conversation on the right

**Status: built.**

- vf-ui: `purchase-orders.js`, `app.css` (copied to vf-portal).
- vf-licence: strings migration 0351.

## What was asked

Dan, 13 October 2026: *"Can we make the Purchase Order page, like the GR page, in it's own screen
with the message panel on the right"*.

Until now an order opened in a wide pop-out (0372), and 0752 put its conversation with the
supplier at the bottom of it, below the lines and receipts.

## What changed

### The page

`openPurchaseOrder` draws the order as `openReceipt` draws a goods receipt (0741):

- in the application's frame, where the invoice viewer draws, over the screen that opened it;
- the top bar carries the order number, then *Purchase order · supplier · company · status*, and
  the order's actions beside Back: Ask supplier (0752), Hold or Release hold, and Close order
  (0377);
- the order on the left: the hold and Query raised banners, the header facts, the lines, and
  receipts and returns (0646);
- the conversation with the supplier on the right, under a Supplier tab, laid out as a receipt's:
  the messages scroll and the box to write in stays at the bottom, the panel kept in view as the
  order scrolls.

While there is no conversation to have (the order is not shared, or nobody at the supplier is
linked, and nothing has been written) the panel says so rather than leaving an empty column.

Back returns to the screen the order was opened from, or to whatever the viewer was showing
before.

### After a change

Hold, Release and Close open the order again in place, with Back still returning to where it was
opened from. When opened from Purchase Orders, the list and its counts refresh behind it.
Opened from Conversations, the pop-out used to redraw the Purchase Orders list behind Tasks; it no
longer does, and Conversations refreshes itself as before.

Ask supplier opens the order again, as before.

The hold reason is asked for in a panel at the top of the order, as it was in the pop-out.

### Words (vf-licence 0351)

1 key, in English and German: what the panel says when there is no conversation yet.

## Tests

- **vf-ui browser** `purchase-orders.test.ts`:
  - the pop-out tests now open the page: in the frame, over the list, no backdrop, every header
    field and line on the left;
  - the conversation panel on the right, saying why there is none;
  - Back to the list, and back to whatever the viewer showed before;
  - a failed fetch says so and opens nothing;
  - held: opened again in place, Release hold and the reason showing, Back still to the list;
  - 0752's: the conversation in the right-hand panel, and the empty panel when not shared.
- **vf-licence** string coverage.
- The full vf-ui browser suite passes except the known `typography.test.ts` gap.
- **Screenshot:** an order with Query raised and its conversation, Day and Night.

## To deploy

Migration: vf-licence `0351_order_page_strings.sql`. Deploy vf-licence and vf-ui (vf-portal only
for the shared stylesheet).
