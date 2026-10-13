# 0771: No note about what the supplier does not see

**Status: built.**

- vf-portal: `invoice-document.js`.

## What was asked

Dan, 13 October 2026, on 0770's Attachments tab in the supplier network: *"we can remove the
message saying 'Only the document itself is shown here: not the email it came in, nor anything else
sent with it.' We don't need to tell the end user what they don't get to see."*

## What changed

The note under the invoice's files is gone. Attachments lists the files, under *As Acme Corp
received it*, and nothing more. What is shared is unchanged: only the invoice's own documents, as
0770 says.

The words (`network.invoice.attachnote`, vf-licence 0362) stay in the strings table unused. 0362
may already be applied, so it is not edited.

AP Setup's own help for the setting still says what is never shared: that is for the customer
choosing whether to share.

## Tests

- **vf-portal** `network.test.ts` passes (40 tests).
- **Screenshot:** the Attachments tab without the note.

## To deploy

Deploy vf-portal. No migrations.
