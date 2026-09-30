# 0573: Create → Upload documents, on a live AP upload route

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0114`** and **`vf-licence` migration `0222`**.

## What was asked

On 30 September Dan parked slice 5 (several samples) and asked about the
draft Source routes (SFTP, File import, EDI) and outbound options. He
then described File import as a job for the AP team rather than IT:

- a **Create** entry under Accounts payable, with:
  - an invoice keyed by hand from a template, with an optional file (a
    self-billing case);
  - a batch upload of CSV or XML making several invoices, including one
    invoice from many rows;
- the Integration screens still showing and monitoring the traffic.

He asked for input. I suggested a third option, **Upload documents**:
several PDFs, images or XML files, or a zip of them, each read into an
invoice exactly as email does. It is the cheapest of the three and the
one an AP team would use most. I suggested building it first, then
Create an invoice, then batch.

Dan chose Upload documents first, confirmed that a "summary invoice"
means one invoice from many rows (for the batch, later), and approved
the mock-up: "looks good thank you".

## What was decided

### One way in: the AP upload route (migration `0114`)

- The standard **File import** route, a draft since 0107, is renamed
  **AP upload** and its version 1 goes **live**.
- **Every process that receives invoices gets an AP upload source**
  (`upload-<process>`), as a Source instance of the route, if it has
  none. Its company (`default_org_unit_id`) is that of the process's
  first email source, where it has one.
- An admin can add or retire more on Process routes, as for any source
  (0557), using the existing *File import* mechanism.
- **`AP.Create`**, a new permission, is granted to every role that
  holds `AP.Validate`.

### An upload is a route message (`vf-app/src/upload-route.ts`)

| Step | Endpoint | What it does |
|---|---|---|
| Where to | `GET /uploads/targets` | Every active AP upload source, with its process and company, and the limits: 50 files, 15 MB each (as email) |
| Open | `POST /uploads` `{sourceId, files}` | A route message on the source, from the person (`Dan Young <dan@…>`), subject "Upload of N files"; an `upload_opened` event names them as actor |
| Each file | `POST /uploads/:id/files?name=` with the file as the body | Stored as the next attachment part, then read by `captureAttachmentPart`, the path an email attachment takes |
| Close | `POST /uploads/:id/finish` | Delivered, partial or failed, as email closes a message |

- Every endpoint needs **`AP.Create`**, by session or key. `vf-ui`
  proxies them, and its allowlist test covers them.
- **Only the person who opened an upload adds to it, and only while it
  is open.** Another person gets 404, and a finished upload 409.
- **What each file is:**
  - known from its name first, then from what the browser said, since a
    browser often sends XML or CSV as bytes;
  - PDF, XML, JPEG, PNG, TIFF and CSV are accepted;
  - anything else is refused in words, and recorded as `upload_refused`
    in the message's history.
- **What a file answers:** created (the invoice's number, supplier,
  total, currency and current stage, with its open task to open it), or
  not read, with why.
- **Everything email gives follows**, because the path is the same:
  - the originals kept;
  - formats and EN 16931 checks recorded;
  - the Route monitor listing it, with Reprocess;
  - the invoice's Timeline saying "Received by AP upload from Dan Young,
    message MSG-…, Read from …" (0571);
  - the file in its Attachments tab.

### The screen (`vf-ui/public/create.js`)

As in the mock-up Dan approved:

- **Create** sits under Accounts payable, after Tasks, for `AP.Create`.
  It keeps every other screen's colour (0527): it is left out of the
  count and takes the fifth colour, which neither neighbour has.
- **Send to** lists the AP upload sources, as "AP upload · process ·
  company". The first is chosen.
- **The drop zone** takes dropped or chosen files. A zip is unpacked in
  the browser: its central directory is read, and stored and deflated
  entries are inflated with `DecompressionStream`. Folders, hidden files
  and `__MACOSX` are left out.
- **This upload** gives:
  - the MSG reference, the number of files and when;
  - counts of created, reading, waiting and not read;
  - a row per file: its name, size and type, then Waiting, Reading…,
    Created (number, supplier, total, "now at" the stage, with **Open**)
    or Not read (why).
- Files are sent **one at a time**, so each row changes as its file is
  read. A file over the limit is marked not read and not sent.
- **Route monitor**, for someone who holds `Integration.Monitor`, opens
  the monitor on this upload's message. The monitor's `open` now takes a
  message to show.
- The Route monitor's history names the new events: Upload started,
  File refused, Upload finished.
- Help for the screen is added.

## Not built

- **Create an invoice** (keyed by hand, self-billing) and **Batch
  upload** (CSV or XML making many invoices, one from many rows). These
  come next, in that order. The mock-up's tabs for them are not shown
  until they exist.
- **A supplier's own XML or CSV uploaded here uses mappings on the AP
  upload route.** Mappings belong to a route (0561). A mapping made for
  email does not read an upload, so a supplier's own format needs its
  mapping made again from the AP upload message, with Map this format in
  the Route monitor. Standard e-invoices, PDFs and pictures need no
  mapping.
- **A possible-duplicate flag on the upload screen.** The mock-up showed
  one; duplicates are caught by the process's own rules, as for email,
  and the invoice says so when opened.
- **Resuming an upload after the page is closed.** It stays open in the
  monitor as received. Files already sent are kept and made into
  invoices, and the rest are simply not sent.

## Verification

- **`vf-app`**: `upload.test.ts`, 6 tests. They cover:
  - the route live and renamed, and the target listed with process and
    company;
  - a file's type from its name before the browser's;
  - an XML file sent as bytes, read as data into invoice 88240 with its
    supplier, total and stage;
  - an image made into an invoice, and a `.docx` refused in words;
  - the upload closed as partial, from Dan, with its size, and his three
    events in its history;
  - the invoice's Timeline naming the upload, and its Attachments tab
    listing both files, this invoice's marked;
  - an upload where nothing was read closed as failed;
  - another person, a finished upload, an email source, too many files,
    none, and a retired source, all refused;
  - through the router: 401 unsigned, 403 with only `AP.Validate`, and
    targets, open and finish with `AP.Create`.

  `routes.test.ts`'s seeded-routes test now expects File import live,
  as AP upload, sorted first by name.

  Migrations replay 114. Full, unfiltered run: 143 files and 3336 tests,
  of which 3333 passed:
  - the two failures already known (0511);
  - that seeded-routes test, which was then updated and passes, 9 of 9.
- **`vf-ui`**, 8 new browser tests, all failing against the code before
  this change:
  - `create.test.ts`, 5 tests using the real strings:
    - targets, the first chosen, and the limits;
    - nowhere to upload to;
    - two files sent on their own into one upload, to the source chosen,
      with their types, then finished, and each row as the server
      answered;
    - a zip with a stored entry, a deflated one, a folder and
      `__MACOSX`, unpacked to two files;
    - a file over the limit not sent, a broken zip, and an upload that
      could not start;
  - `tasks.test.ts`: Create after Tasks, colour 5, the others unchanged;
  - `route-monitor.test.ts`: the monitor opened on one message.

  The proxy test covers the four new paths. Full browser suite: 1385 of
  1386 pass. The one failure is the known `typography.test.ts` 10px gap.
  Worker tests: 81 of 81.
- **`vf-licence`**: `0222` adds 39 keys in English and German, none with
  a `;`. 322 of 322 pass, and migrations replay 222.
- **Screenshot** of the screen after four files, checked by eye against
  the mock-up. It showed a server reason starting in lower case, which
  now starts with a capital.
