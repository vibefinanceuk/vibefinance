# 0739: The supplier record's Supplier Network card, rearranged

**Status: built.** vf-ui (`suppliers.js`, `receipt-sharing.js`, `app.css`; `app.css` copied to
vf-portal), vf-licence (strings migration 0340).

## What was asked

Dan, 12 October 2026, on the supplier record's card: *"1) At the top read Supplier Network.
2) Move the current list of invitees, to the bottom, below the text … 3) Change the
aforementioned text to read 'Invitee will see documents shared for the organisations
specified.'"*

## What changed

- The card is headed **Supplier Network** (was Supplier portal; German Lieferantennetzwerk).
- In order: **Goods receipts in the network** (0738), then **Invite someone from …** with the
  address, companies and its words, then **the people linked and invited**, last, set off by a
  rule.
- The invitation's words: *"Invitee will see documents shared for the organisations
  specified."*
- AP Setup › Supplier Network's count of suppliers with their own setting now names the
  card as the Supplier Network card.

## Tests

vf-ui `suppliers.test.ts`: the invitation before the people, the people last. `receipt-sharing
.test.ts` reads the changed words. vf-licence string coverage.

## To deploy

Migration: vf-licence `0340_supplier_network_card_strings.sql`. Deploy vf-licence, vf-ui (and
vf-portal, whose `app.css` copy changed).
