# 0728: Unread messages in the network: a Messages column and a menu count

**Status: live** at `f00b97c`, pushed and deployed 11 October 2026. vf-app (migration 0161,
`portal-route.ts`), vf-portal (`portal.js`, `shell.js`, `portal.css`), vf-licence (strings
migration 0332).

## What was asked

Dan, 11 October 2026: *"alert in the network if a message is received for an invoice... add a
message column to the Documents tab, and highlight a message count in a pillbox for that
invoice. And perhaps a small count in the Document menu item."* The mock-up: *"looks good"*.
New means **unread**, not unanswered: *"because the highlight will remain, and the supplier
might not need to reply. so the count would continue to increase."*

## What changed

- **Messages** on Documents, before Status: amber *"2 new"* where the customer has written since
  this person last opened the invoice; a plain count where every message is read; a dash where
  there are none. A row with new messages is bold, with an amber edge.
- **A count on Documents** in the side menu, in the app's own badge style: how many invoices have
  unread messages. Shown on Create too.
- **Opening an invoice reads it**, for that person: its pill and the menu's count go down at once.
- **Per person.** Two people at one supplier each have their own. When each person last opened
  each invoice is kept in the customer's own instance (`portal_reads`, by the person's link), not
  in the network, which still keeps nothing.

Also, on Create (0727): every Invoice header field the same height (Dan's screenshot), the read-
only amounts with the inputs and selects.

## Afterwards: the customer's comment in Day's light red

Dan, against a screenshot of a returned invoice in Night: the *From Acme Corp* comment (*"Is this
a duplicate"*) in Day's light red, not deep red. It, and the notice when a customer does not
answer, now use the fixed severity colours, as the fields to put right do (0727).

## Tests

vf-app `supplier-messages.test.ts`: unread until this person opens the invoice, whether or not
they reply; each person their own; a later message unread again. The existing portal and
submission tests pass with the new bind. Checked in Chromium.

## To deploy

Migrations: vf-app `0161_portal_reads.sql`, vf-licence `0332_network_message_counts_strings.sql`.
Deploy vf-app, vf-licence and vf-portal. `scripts/wipe-invoice-runtime-data.sql` clears
`portal_reads` too.
