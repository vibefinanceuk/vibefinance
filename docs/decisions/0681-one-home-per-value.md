# 0681: One home per value — the Peppol BIS 3.0 Business Terms

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app` and `vf-ui`. It needs **vf-app migration `0148`**.
Deploy vf-app and vf-ui. Dan will clear the runtime data and start with
new invoices, so nothing already stored needs to carry over (though the
migration works on existing rows too).

## What was asked

Dan, 7 October 2026, after an audit found the same invoice values
stored in two places:

> I'd like to keep the official peppol biz 3.0 fields, and use for
> eInvoices and scanned or photographed documents, and other formats
> like if appropriate. So we can remove duplicate fields. The one home
> per value is what I'm looking for. We need not be worried about legacy
> data, we are still in system build mode.

## What was wrong

A value could live both as a Business Term in `facts_json` and in a
column of its own. The two were written separately, by some paths and
not others:

- **Embedded-XML invoices** (Factur-X / ZUGFeRD through a source) passed
  only facts, so the header columns `invoice_number`, `issue_date`,
  `currency`, `supplier_vat_id` and `total_with_vat` stayed NULL. Those
  invoices dropped out of:
  - duplicate detection;
  - invoice lookup and supplier history;
  - agents' totals.
- **A scanned line's text** was stored under a plain `description` key
  and column, never as BT-153. So:
  - the viewer needed a separate read-only *Description* column (0171,
    0680);
  - a save in the viewer blanked the column, since it sent BT-153 as
    the description;
  - the ERP export left the description empty.
- **A line's `cost_centre` column** was never filled at capture, only by
  keying and PO matching.

## What was built

### vf-app migration `0148`: the columns become views of the facts

The duplicated columns are now generated columns, worked out from
`facts_json` and never written:

| Column | Business Term |
| --- | --- |
| `invoice_headers.invoice_number` | BT-1 |
| `invoice_headers.issue_date` | BT-2 |
| `invoice_headers.currency` | BT-5 |
| `invoice_headers.supplier_vat_id` | BT-31 |
| `invoice_headers.total_with_vat` | BT-112 |
| `invoice_lines.description` | BT-153, else BT-154 |
| `invoice_lines.amount` | BT-131 |
| `invoice_lines.cost_centre` | BT-133 |

- **Readers are unchanged.** Every query that reads these columns
  (duplicate detection, lookup, history, documents search, dashboards,
  agent queries, coding suggestions) now reads the Business Term,
  whichever way the invoice arrived.
- **Writes are refused.** SQLite rejects any write to these columns.
- **Values are cleaned:**
  - text is trimmed, and an empty string reads as NULL;
  - an amount is a number, or NULL when the fact is not one;
  - facts_json that is not valid JSON gives NULL.
- **Indexes** on the supplier, the supplier and number, and the line
  cost centre are rebuilt on the generated columns.
- **Two standing invariants** check that a column agrees with its
  Business Term.
- **Unchanged:** `mandate_channel` and `duplicate_confidence` are not
  Business Terms and stay ordinary columns.

### Writers store only Business Terms

**`handleUpsertInvoice`** writes the header's facts, `mandate_channel`
and `duplicate_confidence`, and each line's facts only.

- It still accepts the old top-level `invoiceNumber`, `issueDate`,
  `currency`, `supplierVatId` and `totalWithVat`, and writes them into
  BT-1, BT-2, BT-5, BT-31 and BT-112, where they win as the column used
  to.
- It still accepts a line's `description`, `amount` and `costCentre`,
  which fill BT-153, BT-131 and BT-133 where the line's facts lack them.
- Duplicate confidence is worked out from the facts.

**Keying** (`key-fields-route.ts`) writes Business Terms only:

- the header columns it used to send back (0539) are gone;
- a line is its facts;
- a line's text and amount are recorded in provenance as
  `line.N.BT-153` and `line.N.BT-131`, with the rest of its facts. They
  were `line.N.description` and `line.N.amount`.

**Other paths:**

- The PO match panel updates a line's facts only.
- Intake stores each line as `{ lineNumber, facts }`.

**Scanned and photographed invoices** (`extraction.ts`) store a line's
text as **BT-153 (Item name)**, as an e-invoice does, not under a plain
`description` key. Decision 0052's rule still applies: a row with no
text is not a line.

### One line layout for every kind of invoice

- **The field-visibility resolver** no longer adds the read-only
  `description` field (0171). Its reading order names BT-153 and BT-154.
- **The viewer's line table** (0679/0680) is Line no., Item name, Item
  description, Unit, Item net price, Quantity, Line net amount, VAT
  category.
- **The viewer no longer sends** the derived `description`, `amount` and
  `costCentre` with each line.

### Left as they are, deliberately

These keep two places, each for its own reason:

- **Supplier name:** the BT-27 fact (what the invoice says) and the
  supplier master's name, which wins once matched.
- **Supplier terms:** copied onto the invoice at capture, as a snapshot.
- **PO line reference:** the BT-132 fact (what the invoice says) and a
  person's pairing, which overrides it.
- **Split coding:** its own rows.

## Verification

- **`vf-app`:**
  - new `one-home.test.ts`, 5 tests:
    - header columns filled from facts alone, as an embedded-XML
      capture sends them;
    - a column follows its Business Term and cannot be written;
    - line columns from BT-153 (else BT-154), BT-131 and BT-133, with
      a non-number amount giving NULL;
    - the old top-level fields land in the facts;
    - a write to a generated column is refused.
  - 71 test INSERTs and 4 UPDATEs that wrote the old columns now write
    the Business Terms (`json_set` on facts_json).
  - **Updated tests:** upsert (facts now carry the top-level values),
    extraction (a scanned line carries BT-153), field visibility (no
    `description`; order BT-153, BT-154), keying (lines as Business
    Terms; provenance `line.N.BT-131` and `line.N.BT-153`; preserved
    lines' facts).
- **Migrations:** vf-app replay to 148, every assertion held.
- **`vf-ui`** browser `viewer.test.ts`: the line-order test no longer
  has `description`.
- **Full runs**:
  - vf-app 3697, of which 3695 pass (the two known failures), plus
    `one-home.test.ts` run alone, 5 of 5;
  - vf-ui browser 1646, of which 1645 pass (the known
    `typography.test.ts` 10px gap).
