# 0577: A supplier's CSV holding several invoices is read as one invoice each

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0225`**. There is no `vf-app` migration.

## What was asked

0565 read a supplier's own CSV through its mapping, but **one invoice
per file**. A file whose invoice number differed between rows was
refused, naming the numbers. Dan saw that live on 30 September:

> *"the file holds 2 invoices (88252, 88253); one invoice per file is
> read"*

Batch upload (0576) then split a supplier's CSV into invoices by its
mapping. I listed doing the same for email as an open thread, and Dan
asked for it: *"please can you look at Supplier CSVs by email"*.

## What was decided

### Where

The change is in `captureAttachmentPart` (`inbound-email.ts`), so every
way a supplier's file arrives gets it:

- email;
- Upload documents (0573), which reads each file through it;
- Reprocess from the Route monitor.

### How

When an attachment is a CSV (`detectStructure`), `csvInvoiceGroups`
(`supplier-mapping-route.ts`) checks two things:

- the sender's mapping reads it (`mappingFor`, as before);
- it holds more than one value in the column that mapping reads the
  invoice number (BT-1) from.

If so, the rows are grouped by that column with `splitCsvByColumn`, as
Batch upload does. A number's rows need not be next to each other. Each
group keeps the file's skipped lines and header.

**Each group is read as an attachment of its own**, by the one-file path
unchanged (`captureOnePart`, which was `captureAttachmentPart`). That
path covers the mapping, the EN 16931 checks, the process, and the table
of its own rows.

**Every invoice points at the one part**:

- its original is the whole file, kept once;
- `route_message_items` links each invoice with the part's sequence;
- each invoice's Attachments tab has the file.

**When some are not made**, the others still are:

- rows with no invoice number are named;
- a group the mapping cannot read gives the mapping's own reason;
- the part is **captured** when any invoice was made, with the reason "N
  of M invoices made", then each one not made and why;
- the email is **partial**, not delivered.

**The Route monitor** names the split in the history: "Split into
invoices", with "3 invoices (88250, 88252, 88253)" beneath it.

**One invoice per file stays** for a CSV with a single invoice number,
exactly as before. The refusal in `captureThroughMapping` is kept, for
anything that reaches it with several numbers another way.

### Strings

`vf-licence` `0225`:

- adds `routemonitor.event.csv_split`;
- updates the mapping help's line 42, which said "One invoice per file",
  and the CSV fix's sentence about sending one file per invoice.

## Not built

- **Reprocessing a partly made file.** Reprocess leaves alone any
  attachment that already made an invoice, so a group not made the first
  time is not tried again there. Fix the file and send the invoices that
  failed, or upload them with Batch upload.
- **Upload documents' row for such a file** names only the first invoice
  made. All of them are made, and all are in the Route monitor.

## Verification

- **`vf-app`**, `supplier-mappings.test.ts`: the test that expected the
  refusal is replaced by 2 tests.
  - A file of three invoices, with 88252's second row after 88253's:
    - delivered;
    - three invoices with their own totals, all linked to part 1;
    - the part captured, with no reason;
    - the split named;
    - every original the one file.
  - A file where one invoice's date cannot be read:
    - partial;
    - the other made;
    - the reason "1 of 2 invoices made. 88252: …".

  Both fail against the code before this change. With `upload.test.ts`,
  `route-monitor.test.ts` and `batch.test.ts`: 60 of 60.

  The first run found a real case: the fixture repeated line number 1 in
  one invoice. It was refused, rightly, with "line numbers must be unique
  within one invoice", and the fixture was corrected.
- **`vf-ui`**, `route-monitor.test.ts`, 1 new test with the real strings:
  the history shows "Split into invoices" with the invoice numbers. It
  fails against the interface before this change. Full browser suite:
  1394 of 1395 pass. The one failure is the known `typography.test.ts`
  10px gap. Worker tests: 86 of 86.
- **`vf-licence`**: 322 of 322, and migrations replay 225.
- **Full `vf-app` run**: 144 files and 3348 tests, of which 3345 passed:
  - the two failures already known (0511);
  - the supplier-mapping router test, which timed out at 5 seconds while
    other suites ran beside it, as in 0575. Run alone, it passes.
