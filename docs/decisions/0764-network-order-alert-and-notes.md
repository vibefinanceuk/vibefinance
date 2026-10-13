# 0764: The supplier network's order: an alert to confirm, and notes in Messages

**Status: live.**

- vf-app: `order-sharing.ts`: when the order was last invoiced.
- vf-portal: `order-view.js`, `portal.js`, `portal.css`.
- vf-licence: strings migration 0358.

## What was asked

Dan, 13 October 2026, on the lines above an order in the supplier network:

1. *"Can we move these comments."*
2. *"Can 'Acme Corp asks you to confirm you have received this order.' be an alert, such as
   attached Here because message."*
3. *"'Everything ordered has been invoiced.' can this be a system timestamp in the Messages
   window?"*
4. *"'As Acme Corp placed it with you, and how much of it has been received and invoiced so far.'
   this message can be removed, as doesn't make sense."*

## What changed

- **The note about how the customer placed it is gone.**
- **Waiting to be confirmed is an alert**, as the application's *Here because* line (0528): amber,
  with its icon. It reads *To do: Acme Corp asks you to confirm you have received this order.*,
  with **Confirm receipt** in it. *Confirm receipt* stays in the top bar too.
- **What happened is a dated line in Messages**, among what was said, in time order:
  - why the order cannot be invoiced. *Everything ordered has been invoiced.* is dated by the last
    invoice against the order; vf-app now gives that as `invoicedAt`. A note without a time
    (closed, on hold, nothing received yet) comes last;
  - *You confirmed receipt of this order.*, dated when it was confirmed. This replaces 0762's line
    above the order.

  The conversation takes these as `notes` (`{ at, text }`), drawn as a quiet centred line, so
  receipts and invoices can use them later.
- **An order everything of which has been invoiced says so** even where the customer receipts
  goods. Before, it said *Nothing received is waiting to be invoiced*.

### Words (vf-licence 0358)

4 keys, in English and German.

## Tests

- **vf-app** `order-sharing.test.ts`: `invoicedAt` is the last invoice's time, and none for an
  order never invoiced.
- **vf-licence** string coverage. **vf-portal** `network.test.ts`: the words are defined.
- **Related suites pass:** vf-app order sharing and confirmation, vf-portal, and vf-licence
  string coverage.
- **In a browser,** on an order everything of which has been invoiced:
  - the alert, with its *Confirm receipt*;
  - after confirming, both notes in Messages in time order, and the alert gone.

## To deploy

Migration: vf-licence `0358_network_order_notes_strings.sql`. Deploy vf-app, vf-licence and
vf-portal.
