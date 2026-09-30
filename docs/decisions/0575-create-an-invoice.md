# 0575: Create → Create an invoice, keyed by hand, optionally self-billed

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0223`**. There is no `vf-app` migration.

## What was asked

0574 was deployed on 30 September, and Dan confirmed the next step:
**Create an invoice**, the second of the three Create options agreed
under 0573. In his words: *"Create an invoice manually from a template
(perhaps with an accompanying pdf, image or XML file upload). This would
allow the user to manually enter an invoice, similar to a self-billing
scenario."*

My proposal, which he accepted:

- the file is optional, and read first so the form opens filled in;
- the form is the existing keying screen, opened straight away;
- self-billing is a tick box giving invoice type code 389;
- the Timeline says who created it.

## What was decided

### The same way in as an upload

A keyed invoice is an upload of one invoice, so it gets everything 0573
gives:

- a route message on the AP upload source, from the person;
- shown in the Route monitor;
- linked to the invoice;
- started in the process from its first stage.

**The keyed upload.** `POST /uploads` takes `kind: "keyed"` with one file
or none. Its subject is "Invoice keyed by hand", and its `upload_opened`
event says so.

**With a file:** it is read by `POST /uploads/:id/files`, exactly as an
upload's file is, so XML is read as data and a PDF or image by AI.

**With none:** `POST /uploads/:id/keyed` makes an empty invoice through
`captureKeyedInvoice` (`source-capture-route.ts`). This is the path an
unreadable document already takes (`captureWithoutFacts`), with the same:

- org placement from the source's company, or read from the document;
- supplier matching;
- process start.

It is linked to the message with no part, and an `invoice_keyed` event
names the person. **One invoice per keyed upload**: a second call is
refused with 409.

**`intake.structure` is `keyed`**, not empty. So the viewer does not call
it "a document that could not be read", and a rule can tell a keyed
invoice apart.

### Self-billed

The tick box sets **BT-3 = `389`**, EN 16931's code for a self-billed
invoice, and the fact **`invoice.selfBilled` = 1**, which a rule can
test.

- **With a file**, they are set on the invoice once it is read
  (`?selfBilled=1`), whatever the file said.
- **With none**, it starts with them.

### The screen

- Create now has two tabs, **Upload documents** and **Create an
  invoice**, as in the approved mock-up. Batch upload's tab follows when
  it exists.
- **Create an invoice** has:
  - a line saying what it does;
  - Send to;
  - **Start from a file (optional)**: a PDF, image or XML file, with
    Choose file and Remove;
  - **Self-billed invoice**, with what it means;
  - **Create invoice**.
- **Create invoice** makes the invoice and **opens it at once in the
  viewer**, with its full task (0574), to be claimed and keyed. It is
  also listed on the right, with Open, in case the viewer is closed. An
  invoice with no task this person can open is only listed.
- **The Timeline** says "Created by hand by Dan Young, message MSG-…", in
  place of "Received by …". "Read from …" follows when it started from a
  file.
- The Route monitor names the new event, and help covers the tab.

## Not built

- **A self-billing agreement on the supplier**, with a check at
  Validation that a self-billed invoice's supplier has one. This needs a
  field on the supplier record and the Suppliers screen. Until then, a
  customer's own rule on `invoice.selfBilled` can route it for review.
- **Self-billing wording on a generated document.** A keyed invoice has
  no rendering yet.
- **Stopping the person who created an invoice from approving it.** It
  is left to a customer's rule for now. The Segregation of duties report
  (0425) already shows it after the event.
- **Batch upload**, the third Create option, is next.

## Verification

- **`vf-app`**: `upload.test.ts`, 3 new tests. They cover:
  - a self-billed invoice with no file:
    - made in the company of the AP upload source, with BT-3 `389`,
      `invoice.selfBilled` and `intake.structure` `keyed`;
    - a second invoice refused;
    - the upload delivered as "Invoice keyed by hand";
    - its Timeline entry marked keyed;
  - a file read first and marked self-billed, with its own invoice
    number kept, and no second invoice beside it;
  - two files refused for a keyed upload.

  All 3 fail against the code before this change. With
  `received-files.test.ts`: 22 of 22.
- **`vf-ui`**: `create.test.ts`, 3 new tests using the real strings:
  - the two tabs, the panel, and self-billing explained;
  - no file and self-billed: a keyed upload, then `/keyed` with
    `selfBilled: true`, then finish, and the viewer opens on the task
    with Claim;
  - a chosen file sent with `selfBilled=1`, and no `/keyed` call.

  Also `viewer.test.ts`, 1 new test: the Timeline's "Created by hand by…"
  line. All 4 fail against the interface before this change. The proxy
  test covers `/uploads/:id/keyed`.
- **`vf-licence`**: `0223` adds 18 keys in English and German, none with
  a `;`. Migrations replay 223.
- **Screenshot** of the tab with a file chosen and self-billing ticked,
  checked by eye. It showed the right-hand card's empty text speaking of
  uploads, which now speaks of the invoice to be created.
- **Full runs:**
  - `vf-app`: 143 files and 3340 tests, of which 3337 passed:
    - the two failures already known (0511);
    - one router test that timed out at 5 seconds while three suites
      ran at once. Run alone, it passes.
  - `vf-ui` browser: 1390 of 1391 pass. The one failure is the known
    `typography.test.ts` 10px gap.
  - `vf-licence`: 322 of 322.
