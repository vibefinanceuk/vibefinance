# 0744: Create an invoice is keyed from nothing; a file goes through Upload documents

**Status: built.** vf-ui (`create.js`), vf-licence (strings migration 0343).

## What was asked

Dan, 12 October 2026: *"we have Create an Invoice and Upload Documents. The Create Invoice also
provides the opportunity to choose a file (pdf or XML). Is this not the same functionality as
'Upload Documents'"*. It was, almost: both send the file the same way (0575 made a keyed
invoice "an upload of one invoice"); Create an invoice only added opening it at once and the
self-billed tick. Proposed: Create an invoice from nothing only, and the self-billed tick on
Upload documents for the whole upload. *"yes please - that makes more sense"*.

## What changed

- **Create an invoice** has no file to start from: one invoice keyed from nothing, optionally
  self-billed, opened straight away to be claimed and keyed, as before. Its words say so, and
  that a file goes through Upload documents.
- **Upload documents** gains **Self-billed invoices**, ticked before the files are dropped:
  every invoice in the upload is marked self-billed (invoice type 389), as a file in Create an
  invoice was. The server already took `selfBilled` on any upload's file (0575).
- No server change; the keyed route still accepts one file (`kind: "keyed"`, `files: 1`) for
  any caller that sends one.

## Tests

vf-ui `create.test.ts`: Create an invoice has no file picker; a file ticked self-billed on
Upload documents is sent with `selfBilled=1`; the existing upload and keyed tests unchanged
and passing. vf-licence string coverage. Checked in Chromium.

## To deploy

Migration: vf-licence `0343_create_keyed_no_file_strings.sql`. Deploy vf-licence and vf-ui.
