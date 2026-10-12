# 0742: Create › Goods receipts — the kind as a rounded pill, and a small Save

**Status: built.** vf-ui (`create.js`, `goods-receipts.js`, `app.css`; `app.css` copied to
vf-portal).

## What was asked

Dan, 12 October 2026, with a screenshot of Create › Goods receipts › Key a receipt: *"1) The
invoice / goods receipt tabs, please can you change to look like the more rounded pillbox to
the right of it. 2) please can you change the save icon, so that it is smaller, with text to
the right, consistent with other screens. Please can you also change the save button in the
'Key a return' tab also."*

## What changed

- **Invoices / Goods receipts** on Create is drawn as the same rounded pill as Upload receipts
  (CSV) / Key a receipt / Key a return beside it (`.doctabs` / `.doctab`), the chosen one raised.
  Same ids and behaviour.
- **Save** on Record a receipt and Record a return is a compact action — a small icon with the
  word to its right — as on the other screens' cards; Close on the same form in its pop-out
  too.

## Tests

vf-ui `goods-receipts.test.ts`: the kind buttons are pill tabs; Save on Key a receipt is
compact. Checked in Chromium, Night.

## To deploy

Deploy vf-ui (and vf-portal, whose `app.css` copy changed). No migration.
