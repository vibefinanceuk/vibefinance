# 0566: Reading a captured file again with a newer mapping, and a failed file's card

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0217`**. There is no `vf-app` migration.

## What was asked

On 30 September Dan tested supplier CSV (0565).

- `Rechnung_88251.csv` was read, but broke BR-CO-15. We looked at the live
  mapping together and found BT-110, the VAT total, was not mapped.
- He added it and published version 2, then reprocessed the email.
  Reprocess reruns only the files that failed, so 88251 kept its version 1
  facts and its broken rule. The other file, which holds two invoices, was
  refused again, as it should be.
- The card for that refused file said "Read with … version 1", and showed
  its reason only in the technical detail.
- A card with one broken rule said "1 rules broken".

Dan asked for three things:

- a way to read a captured file again with a newer mapping version, while
  nobody has worked on its invoice;
- a failed file's card that says what was tried and why;
- "1 rule broken" for a single rule.

## What was decided

### Reading again (`mapping-reread.ts`)

The endpoint is `POST /route-messages/:id/parts/:seq/reread`, under
`Integration.Monitor` like Reprocess. It is also added to the `vf-ui`
proxy allowlist and its test (the lesson from 0564).

**The same invoice, never a second one.** A second invoice would score as
a duplicate of the first (0028), and an archived first one would read as
discarded elsewhere. So:

- The invoice's facts and lines are replaced by what the live version
  reads, through the existing upsert, which already replaces a line set
  whole.
- Its open tasks are cancelled, with the reason "read again with <mapping>
  version N".
- Its **own** process instance starts again at the first stage of the
  process version it runs under (0150), and is visited as a new invoice
  would be. `handleCaptureIntake` takes `existingInstanceId` for this. The
  instance must be this invoice's and in progress, and no second one is
  created.
- The part records the new version and its EN 16931 result. The history
  gains a `reread` event, with who did it.

**Read first, and change nothing until it reads.** The live version is
first applied to the stored file. If it cannot read it, the request is
refused with its problems, and nothing is touched: no tasks cancelled, no
stage reset.

**Only while nobody has worked on the invoice.** Each of these is refused
in words:

| Refusal | Why |
|---|---|
| `worked_on` | A person claimed, released or reassigned one of its tasks, or claimed, completed or ended one. |
| `exported` | The invoice is in an ERP export. |
| `not_in_progress` | Its process has finished. |
| `mapping_retired` | The mapping is retired, or has no live version. |
| `no_newer_version` | It was already read with the live version. |
| `no_invoice` | No invoice is linked to the part. |

Each means someone may have relied on what the invoice said, or that there
is nothing to do.

**In the Route monitor**, each part now carries `reread`:

- `{can: true, version}` where it can be read again;
- `{can: false, reason}` where a newer version is live, but it cannot;
- `null` otherwise.

The part's card says so. It either offers **Read again with version N**,
or says why the invoice is not read again. After a re-read, the card shows
the new result, and a note says how many rules broke.

### A failed file's card

A supplier file that failed says "Tried with <mapping>, version N:"
followed by its reason. For example: "Tried with Lager Nord CSV, version
2: the file holds 2 invoices (88252, 88253); one invoice per file is
read". A file that was read still says "Read with …".

### One rule broken

`routemonitor.brokenone` is "1 rule broken", and the plural stays
"{n} rules broken".

### Strings and help

`vf-licence` `0217` adds 16 keys in English and German, and none holds a
`;` (0565's lesson). It also updates the mapping editor's help line on
versions to say an invoice can be read again from the Route monitor.

## Not built

- **Reading again an invoice somebody has worked on.** That needs a
  person's decision about what to do with work already done. Discard it,
  and send the file again.
- **Reading a whole message again.** Each file is read again on its own,
  from its card.
- **Refreshing the invoice's display columns** (org unit, supplier) after
  a re-read. The rules see today's values through the intake enricher. The
  stored columns keep what capture wrote, which is the same supplier.

## Verification

- **`vf-app`** `supplier-mappings.test.ts` has 3 new tests. The scenario:
  version 1 of a mapping lacks the VAT total, an invoice is captured with
  it, then version 2 adds it. The tests cover:
  - the monitor offering to read it again; reading it again gives the same
    invoice and one instance, BT-110 present, the part at version 2, no
    rules broken, and a `reread` event; then nothing more is offered, and
    a second attempt is `no_newer_version`;
  - a claimed task refused as `worked_on`, with nothing changed;
  - a finished process refused, and a live version that cannot read the
    file refused with its problems, with nothing changed.

  Against the monitor and capture code before this change, the two tests
  that read again fail. `index.test.ts` checks, through the real router,
  that reread needs `Integration.Monitor`, and covers 404 and 405. Full,
  unfiltered run: 141 files and 3309 tests, of which **3307 passed**. The
  two failures are the ones already known (0511).
- **`vf-ui`** browser `mapping-editor.test.ts` has 3 new tests using the
  real strings:
  - a failed file's "Tried with …: <reason>", and "1 rule broken";
  - the offer, the re-read, the note, and the card afterwards;
  - the reason a file is not read again.

  All 3 fail against the interface before this change. The proxy test
  fails without the new allowlist entry. Full browser suite: 1366 of 1367
  pass; the one failure is the known `typography.test.ts` 10px gap. Worker
  tests: 75 of 75.
- **`vf-licence`**: 322 of 322 pass, with `0217` loaded and its keys
  covered.
- **Migrations**: `vf-licence` replays 217. `vf-app` is unchanged at 112.
