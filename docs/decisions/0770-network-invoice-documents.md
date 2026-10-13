# 0770: Suppliers see the invoices and credit notes they sent, in the supplier network

**Status: live.**

- vf-app:
  - migration 0173;
  - `portal-documents.ts` (new);
  - `portal-route.ts`, `receipt-sharing.ts`, `index.ts`.
- vf-portal:
  - `invoice-document.js` (new);
  - `view.js`, `portal.js`, `portal.css`, `network.ts`, `index.ts`.
- vf-ui: `receipt-sharing.js` (AP Setup).
- vf-licence: strings migration 0362.

## What was asked

Dan, 13 October 2026: *"Is there an option do you think to show Document and Attachments for
Invoices and Credit notes in the Supplier Network? What are the benefits / cautions?"*

**The benefits:**

- both sides look at the same page;
- fewer queries;
- the supplier can see where a PDF was misread;
- a credit note sits beside the invoice it credits.

**The cautions:**

- the email an invoice came in is the customer's: a colleague's forwarding note, internal
  addresses, another supplier's invoice in the same email;
- scanned invoices can carry the customer's own stamps and notes;
- the customer's coding and corrections must stay theirs;
- some customers will want it off.

He approved a mock-up drawn with the network's own page: *"Looks good - thank you."*

## What changed

### In the supplier network

An invoice or credit note has **Document, Attachments and Messages**, as an order (0765). The
Document is shown first, beside the cards at the order's 3:2 width.

- **Document:** the file the customer received, as they received it. That is the supplier's own
  PDF, or the page drawn from their e-invoice (as in the invoice viewer); bare XML is drawn as 0279
  draws it.
- **Attachments:** *As Acme Corp received it*. It lists the invoice's own files, each to download:
  - the page drawn from an e-invoice;
  - the original, said as *Your PDF, as sent* or *Your e-invoice, as sent*;
  - the e-invoice inside a PDF.

  A note says that only the document itself is shown, not the email it came in nor anything else
  sent with it.
- **Without a document,** or with sharing off, the page is as it was: the conversation alone.

### What is shared, and what never is

- **Only an invoice's stored documents** (`invoice_documents`: `original`, `embedded_xml`,
  `generated_rendering`).
- **Never route message parts:** the email, its body, its headers and its other attachments.
- **Only to the supplier it belongs to:** the same scope the network's list and page use (their
  supplier record, in the companies their link covers). Anything else is the same 404 as none.
- **A drawn page can run nothing.** It is HTML from XML the supplier sent, so it is served with
  `Content-Security-Policy: sandbox; default-src 'none'; …`. The supplier network's passthrough
  keeps that policy, and adds it to any page that came without one.

### The setting

**AP Setup › Supplier Network › Invoices and credit notes:** *Show suppliers the documents they
sent*. It is **on** by default, since the document is the supplier's own. It can be turned off for
a customer whose scanned invoices carry its own stamps or notes (`network_sharing_config.share_documents`,
migration 0173).

### Words (vf-licence 0362)

10 keys, in English and German.

## Tests

- **vf-app** `portal-documents.test.ts`, 4 tests:
  - the invoice lists its own documents, the drawn page first;
  - the page to look at is sandboxed, bare XML is drawn and sandboxed, and each file downloads
    named for the invoice (`INV/2` as `INV_2.pdf`);
  - nothing for another supplier's invoice, a file the invoice does not have, or without a token;
  - none once AP Setup turns it off, and on by default.
- **vf-app** `receipt-sharing.test.ts`: the setting rides along with the others, untouched.
- **vf-portal** `network.test.ts`:
  - the file passes through with its policy and without the instance's other headers;
  - only `file` and `download` are forwarded;
  - a page without a policy is given one;
  - nothing for another link or a stale session;
  - the page is served and its words are defined.
- **vf-ui browser** `receipt-sharing.test.ts`: AP Setup's setting, on by default, saved when turned
  off.
- **vf-licence** string coverage.
- **Related suites pass:**
  - vf-app's portal, sharing, network and document suites (8 files, 100 tests);
  - the full vf-ui browser suite, except the known `typography.test.ts` gap;
  - vf-portal.
- **Screenshots:** the invoice's Document and Attachments in the supplier network, as approved.

## To deploy

Migrations: vf-app `0173_network_document_sharing.sql`, vf-licence
`0362_network_invoice_document_strings.sql`. Deploy vf-app, vf-licence, vf-ui and vf-portal.
