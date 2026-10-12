# 0743: Create — the ways to bring something in, as cards

**Status: built.** vf-ui (`create.js`, `app.css`; `app.css` copied to vf-portal), vf-licence
(strings migration 0342).

## What was asked

Dan, 12 October 2026: *"rethink the UI for the Create screen … Keep the Invoice and [Goods
receipts] pillboxes, but instead show the three options for each as cards on the same screen.
For example, when the invoice pillbox is selected, show cards for 'Create an invoice', 'Upload
a document', or 'Batch Upload'. Similarly for goods receipts, show 'Upload Receipts', 'Key a
receipt', or 'Key a return'."* After the mock-up: *"yes, lets build as shown"*.

## What changed

- Under **Invoices / Goods receipts** (0742), the three ways are **cards** in place of tabs
  (0575, 0653): an icon, the way, and a line on what it is for.
  - Invoices: **Create an invoice**, **Upload documents**, **Batch upload**.
  - Goods receipts: **Upload receipts (CSV)**, **Key a receipt**, **Key a return**.
- **Nothing is chosen when Create opens**: the cards alone, so what each is for is read first.
  Choosing one turns the cards into a slim row with the chosen one outlined, and its form
  below, as before; another card can be chosen from there. Goods Receipts' Load and Record
  shortcuts still open Create on the matching card. Someone who may do only one kind sees that
  kind's cards, with no pill.
- One column on a narrow screen. Ids as the tabs had (`create-tab-…`, `create-grtab-…`).

## Tests

vf-ui `create.test.ts`: the cards, each with its line, nothing chosen; the existing upload,
keyed and batch tests choose their card first. `goods-receipts.test.ts`: the receipts' cards,
the slim row once chosen, and the shortcuts' card chosen. vf-licence string coverage. Checked
in Chromium.

## To deploy

Migration: vf-licence `0342_create_cards_strings.sql`. Deploy vf-licence, vf-ui (and
vf-portal, whose `app.css` copy changed).
