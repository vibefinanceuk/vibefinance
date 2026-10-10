# 0721: The conversation with the supplier (supplier portal, Phase 2a)

**Status: live** at `c375606`, pushed and deployed 10 October 2026. vf-app (migration 0158,
`supplier-messages.ts`), vf-portal, vf-ui, vf-licence (strings migration 0326).

## What was asked

Dan, 10 October 2026: *"yes - lets go with phase 2"* of docs/design/supplier-portal.md
(collaboration). His choices: the conversation in **its own Supplier tab** on the invoice, an
**Ask supplier** action, and **both sides told by email**. Mock-ups of the three screens, then
*"confirmed"*, with:

- Ask supplier keeps the invoice where it is and the task open (unlike Return to supplier).
- The people told are those linked in the network for the invoice's company. With nobody
  linked, Ask supplier is not offered.
- Phase 2 in two parts: **2a** the conversation (this record), **2b** a corrected PDF attached
  to a supplier's reply, later.

## What changed

**vf-app.** A `supplier_messages` table (migration 0158): the invoice, the supplier, the
direction (`to_supplier` / `from_supplier`), the kind (`question` / `message`), who wrote it,
the lines it is about, and who was emailed (or why not).

- `GET /invoices/:id/supplier-messages`: the conversation, who would be told, whether it is
  available (the `supplier_portal` licence feature and somebody linked, or a conversation
  already), and whether a question is waiting. `POST` writes (`ask: true` for a question,
  `lines` optional). Needs `AP.Validate`, `AP.Code`, `AP.Match` or `AP.Approve`, or to be a
  collaborator on the invoice. 409 `no_recipients` when nobody is linked.
- **Who is told**: the supplier's active portal links whose companies cover the invoice's
  company or a company above it. Each is emailed with a link to the network.
- `POST /portal/invoices/:id/messages` (portal token, scoped as 0714): the supplier's reply.
  It emails whoever holds the open task (claimed, else owner) and whoever last wrote from the
  customer.
- The supplier sees **Query raised** while a question is the customer's last word, unless the
  invoice is finished. The portal view never shows who at the customer wrote, or who was
  emailed.
- The Timeline gains *asked*, *wrote to* and *replied for* entries, with who was emailed.
- `GET /invoices/:id` gains `supplierQuery` (who asked, when) while one waits.

**vf-portal.** The invoice pop-up shows the conversation and a reply box
(`POST /api/invoices/:linkId/:invoiceId/messages`).

**vf-ui.**

- A **Supplier** tab beside Timeline / Chat, only when the conversation is available: who a
  message goes to, the messages (the supplier's under their address and name), and a box to
  write in when somebody is linked.
- **Ask supplier** among the task's actions when somebody is linked: the question, the lines it
  is about, who will be emailed, and that the invoice and task stay put.
- An amber banner while a question waits: *Asked {supplier} on {when} ({who}), awaiting their
  reply*.
- `supplier-chat.js` (new); the proxy allows `/invoices/:id/supplier-messages`.

**vf-licence.** Strings, en and de (migration 0326).

## Afterwards: the question box at full width

Dan, against a screenshot: *"Could you change the text box, so that it align with the width of
the pop-out"*. The box was named `askquestion`, which is already Help's question bubble
(0519) with `max-width: 85%`. Renamed `asksupplierquestion`; a browser test checks the box is
as wide as its field.

## Afterwards: the supplier's own message readable in Night

Dan, against a screenshot of the network: *"when they comment - it's not possible to see their
reply. Is this a font colour issue?"* It was. The supplier's message used `--severity-ok-bg`,
which stays light in both themes, under Night's light text. It now uses `--bg-success`, which
follows the theme as the customer's `--bg-warning` already did. A vf-portal test refuses any
fixed severity background without its own text colour.

## Not in this

A corrected document with a reply (2b). Return to supplier landing as a portal query. Customer
replies marked from the Timeline (the Supplier tab is where the supplier is written to).

## Tests

- vf-app `supplier-messages.test.ts`: who is told (company and companies above it, never an
  ended link), nothing offered without the licence or anyone linked, Ask records the question
  and lines, the reply ends the wait and emails who asked, both on the Timeline, a supplier
  cannot write outside their scope, the route's permission.
- vf-portal `network.test.ts`: the reply goes to the instance of that link only.
- vf-ui `supplier-chat.test.ts` and `viewer.test.ts`: the tab, sending, Ask supplier with lines,
  the banner, and neither offered when nobody is linked. The proxy test names the new route.
- vf-licence string coverage lists the 33 keys.

## To deploy

Migrations: vf-app `0158_supplier_messages.sql`, vf-licence `0326_supplier_conversation_strings.sql`.
Deploy vf-app, vf-licence, vf-ui and vf-portal. vf-app reads `NETWORK_URL` if set, else
`https://network.vibefinance-ai.com`.
