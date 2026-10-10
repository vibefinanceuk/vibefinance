# 0724: Return to supplier shows in the supplier network

**Status: live** at `0d3a0e5`, pushed and deployed 10 October 2026. vf-app (migration 0159,
`return-route.ts`, `supplier-messages.ts`, `portal-route.ts`, `activity-route.ts`), vf-portal,
vf-ui (`supplier-chat.js`), vf-licence (strings migration 0328).

## What was asked

Dan, 10 October 2026: *"Lets do 'Return to supplier also showing in the network'"* (Phase 2 of
docs/design/supplier-portal.md). His choices:

- A new **Returned** status, apart from Rejected.
- **Both** emailed: the supplier record's address as today, and the people linked in the
  network for the invoice's company.
- The supplier **may reply** to a returned invoice.

## What changed

Until now a returned invoice showed in the network as Rejected, the same as a discarded one,
with only the comment for the supplier.

- **Returned** (`returned_manually`) is its own status, between Query raised and Approved, in
  amber. **Rejected** is now only a discarded invoice (`archived`).
- When somebody at the supplier is linked for the invoice's company, Return to supplier also:
  - records a message to the supplier, kind `return`: the reason, then the comment;
  - emails the linked people, with a link to the network (not the supplier record's own address
    a second time);
  - adds the network link to the return's own email to the supplier record's address.
- Nobody linked, or the portal not licensed: nothing changes from before.
- The network shows the return in the invoice's conversation (*"Acme Corp · returned to you"*),
  and the comment is not repeated above it. Help explains Returned.
- The supplier can reply. Their reply goes on the Supplier tab and emails whoever returned it.
  The invoice stays returned; nothing reopens.
- The invoice's Supplier tab labels the message *Returned to supplier*. The Timeline keeps its
  one Return to supplier entry (no second one for the message).
- Best-effort, as the return's email: the return has already happened when this runs.

Migration 0159 rebuilds `supplier_messages` to allow the third kind (0158 listed the kinds in a
CHECK). Strings in migration 0328.

## Tests

- vf-app `supplier-messages.test.ts`: the return in the conversation with reason and comment,
  the linked people emailed, the return's email naming the network, Returned and no repeated
  comment in the network, one Timeline entry; the supplier's reply emails who returned it and
  the invoice stays Returned; nothing in the network with nobody linked.
- vf-app `portal-route.test.ts`: returned maps to Returned, discarded to Rejected.
- vf-ui `supplier-chat.test.ts`: the return's label and its lines.
- Migration replay (159), string coverage.

## To deploy

Migrations: vf-app `0159_supplier_messages_return.sql`, vf-licence
`0328_return_in_network_strings.sql`. Deploy vf-app, vf-licence, vf-ui and vf-portal.
