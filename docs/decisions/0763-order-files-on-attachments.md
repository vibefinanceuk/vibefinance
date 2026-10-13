# 0763: An order's PDF, UBL XML and CSV on its Attachments tab

**Status: live.**

- vf-ui: `attachments.js`, `order-document.js`, `purchase-orders.js`, `app.css` (copied to
  vf-portal).
- vf-portal: `order-document.js`, `order-view.js`, `portal.js`, `portal.css`.
- vf-licence: strings migration 0357.

## What was asked

0760 put the order's downloads (PDF, UBL XML and CSV) as links above the PDF on the Document tab.
Dan, 13 October 2026, with screenshots of that and of the order's Attachments tab:

> "Rather than show the PDF download, UBL XML download and CSV download … could we format as other
> locations with an Attachments tab, providing available downloads."

## What changed

**The Document tab shows the PDF and nothing else**, in VibeFinance and in the supplier network.

**In VibeFinance**, the order's Attachments tab gains a group after what came in with the order:
*The order as the supplier gets it*. Its rows are:

- `PO-7.pdf` (PDF);
- `PO-7.xml` (UBL XML);
- `PO-7.csv` (CSV).

Each row has its **Download**, as received files do. Picking the PDF shows it below, as a received
file is shown; the XML and CSV are download only. Where nothing came in with the order, the PDF is
shown first.

The Attachments tab takes these as files made from the record itself (`generated` in
`buildAttachmentsTab`). Invoices and receipts pass none and are as they were.

**In the supplier network**, the order's right side has a third tab, **Attachments**, after
Messages and Document. It holds one group, *The order as Acme Corp sends it*, with the same three
rows, each to download. What the customer received with the order is theirs, and is not shown to
the supplier.

### Words (vf-licence 0357)

3 keys, in English and German.

## Tests

- **vf-ui browser** `order-timeline.test.ts`:
  - the Document tab has no links;
  - with nothing received, Attachments shows the order's PDF;
  - with an email received, it lists that email first, then the order's three files, named and
    described. It shows the email, and each file's Download asks for it as a download.
- **vf-licence** string coverage. **vf-portal** `network.test.ts`: the words are defined.
- **Related suites pass:** the full vf-ui browser suite, except the known `typography.test.ts`
  gap, vf-portal, and vf-licence string coverage.
- **Screenshots:** both Attachments tabs, in Day and Night.

## To deploy

Migration: vf-licence `0357_order_attachments_strings.sql`. Deploy vf-licence, vf-ui and vf-portal.
