# 0571: The message an invoice came in, in the Timeline, and an Attachments tab

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0221`**. There is no `vf-app` migration: everything shown was
already kept by routes (0556).

## What was asked

Slice 4 (0570) was confirmed live on 30 September: a template published
with AI proposals, and the next invoice reached Validation. Before slice
5, Dan asked for two improvements:

- **The Timeline / Chat names the message** an invoice came in, for
  example `MSG-7A86-7670-F2A5`, "unique to the transmission".
- **The XML tab becomes Attachments**, giving "access to anything we
  have received": the email, the XML, image or PDF, and so on.

## What was decided

### What was received (`vf-app/src/received-files.ts`)

Nothing new is stored. A route keeps every message and each of its parts
(`route_messages`, `route_message_parts`), and records which invoice a
part made (`route_message_items`, and `invoice_documents`'
`route_message_id` and `part_seq`).

- `messagesForInvoice`: the inbound messages an invoice came in, oldest
  first, with the source's name, the sender, the subject, and the file
  the invoice was read from.
- `receivedFiles`, in this order:
  - each message's parts: the email as it arrived (`original`), then
    every attachment. This includes attachments that made other invoices
    or were skipped, because Dan asked for *anything* received;
  - the XML inside a hybrid PDF (`embedded_xml`);
  - the original document, only when no message holds it (an upload, or
    an invoice captured before routes kept messages).
- Each file is marked **this invoice** when it is the one read, and is
  either **shown** or **download only** (`viewFor`).

| What the file is | How it is shown |
|---|---|
| XML | rendered as escaped text (0279's `renderXmlForDisplay`) |
| CSV | as a table (0565's `renderCsvTable`) |
| an email (`.eml`) | as a person reads it: From, To, Cc, Date, Subject, its text, and the names of its attachments |
| plain text | as escaped text |
| PDF, PNG, JPEG, GIF, WebP | as it is |
| HTML, SVG, and anything else | **download only**, never shown |

**Showing an email.** Headers are unfolded, and names written as
`=?utf-8?Q?…?=` or `=?utf-8?B?…?=` are decoded. The text body is found
through nested multiparts and decoded from base64 or quoted-printable in
its own character set. An email with only an HTML body is turned into
text. Everything is escaped. An email's HTML belongs to someone else, so
it is never run.

**Safety.** HTML or SVG from outside, shown on the document link's
origin, would run as that origin. So only this app's own renderings are
HTML, and they carry `Content-Security-Policy: default-src 'none';
style-src 'unsafe-inline'`, so no script runs. Every response has
`X-Content-Type-Options: nosniff`.

### Endpoints

- `GET /invoices/:id/attachments` returns the messages and files.
- `POST /invoices/:id/attachments/:messageId/:seq/url` mints a link for
  one received part.
- Both are gated like the document itself (`/invoices/:id/document-url`):
  `AP.Validate`, `AP.Code`, `AP.Match`, or a collaborator on the invoice.
  They are proxied by `vf-ui`, and its allowlist test covers them.
- `GET /received-files/:token` is unauthenticated, the token being the
  authority, as `/document-pages/:token` (0381). `?download=1` gives the
  file under its own name.
- **A part token** (`mintPartToken`, `verifyPartToken`): `part.` plus the
  invoice, the message, the sequence, the expiry and a signature. It lasts
  five minutes, as the others do, and is its own shape, for 0381's
  reason. The invoice is in the token, and the fetch checks again that
  the message is still one of that invoice's. A message the invoice did
  not come in is refused, even with a genuine token.
- `/documents/:token` also takes `?download=1`, so the XML inside a PDF,
  or an original no message holds, can be downloaded too.

### The Timeline

The received entry now carries the message, the source, the sender and
the file. It reads:

> Received by AP mailbox from vibefinanceuk@gmail.com, message
> MSG-7A86-7670-F2A5
> Read from Rechnung_88250.pdf

An invoice that came in no message still says "Invoice received".

### The Attachments tab (`vf-ui/public/attachments.js`)

- It replaces the XML tab, and is **offered for every invoice**. The XML
  that tab showed is one of the files listed, and is shown first.
- **It loads the first time it is opened**, not with the invoice: most
  people never open it.
- Files are grouped by message. Each group's heading gives the
  reference, the sender, the source and when it arrived. Anything kept
  with the invoice (the XML inside the PDF, or an original with no
  message) comes last, under "Kept with the invoice".
- Each row gives the file's name (the email is "The email"), its size,
  **This invoice** where it applies, and **Download**.
- Choosing a row shows the file below the list. A file that is download
  only says so.
- The file shown first is the XML inside the PDF, else the email, else
  the first that can be shown.
- The frame asks for a fresh link when it loads again, as the viewer's
  own frames do (0380).
- The pop-out document window shows the same tab beside the standing
  Timeline (0394).

### Strings

`vf-licence` `0221` adds 16 keys in English and German, none with a `;`.
`viewer.xmltab` is no longer used, and is left in place.

## Not built

- **A link from the message reference to the Route monitor.** The
  Timeline also shows in the pop-out document window, where opening
  another screen has nowhere to go. The monitor also has no way yet to
  open one message by its reference. Both can follow if wanted.
- **Outbound messages** (an ERP export's delivery) are not listed. Only
  what was received is.
- **Showing TIFF images.** Browsers cannot show them, so they are
  download only.

## Verification

- **`vf-app`**: `received-files.test.ts`, 13 tests. It seeds an email
  with four parts, a second message the invoice did not come in, the
  XML inside a PDF, and an invoice no message holds. It covers:
  - the Timeline's received entry with the message, source, sender and
    file, and the plain entry when no message holds the invoice;
  - the list in order, this invoice's file marked, the SVG download only,
    and no duplicated original;
  - the original listed for an invoice no message holds;
  - both endpoints refused without permission;
  - the email shown with a decoded sender, its text decoded from
    quoted-printable, a `<script>` in its text escaped, the attachment
    names listed and the base64 left out;
  - a PDF shown in place, and downloaded under its own name;
  - an SVG only downloaded, with `nosniff`;
  - a message the invoice did not come in, a missing part, a forged token
    and a genuine token for another message, all refused;
  - the XML inside the PDF downloaded;
  - the part token round trip, expiry and tampering;
  - `viewFor`, and an email with only an HTML body.

  The Timeline test fails against the code before this change. Full,
  unfiltered run: 142 files and 3330 tests, of which **3328 passed**. The
  two failures are the ones already known (0511).
- **`vf-ui`**, in `viewer.test.ts`:
  - 7 tests replace the XML tab's 6 and its frame test: the tab offered
    and nothing fetched until opened; grouping, the headings, names and
    sizes, "This invoice", the XML inside the PDF shown first; choosing
    the email, and a file that is download only; Download; a fresh link
    on reload; empty and failed; back to Document;
  - 1 new Timeline test.

  All 8 fail against the interface before this change.
  `document-window.test.ts`'s two XML tests now use Attachments. The proxy
  test covers both new paths. Full browser suite: 1377 of 1378 pass. The
  one failure is the known `typography.test.ts` 10px gap. Worker tests:
  77 of 77.
- **`vf-licence`**: 322 of 322 pass, with `0221` loaded and its keys
  covered.
- **Migrations**: `vf-licence` replays 221. `vf-app` is unchanged at 113.
- **Screenshot** of the pop-out document window, checked by eye. It shows
  the Attachments tab with an email, its PDF, a delivery note image, an
  HTML attachment and the XML inside the PDF, the email shown below, and
  the Timeline naming the message. The first version's Download buttons
  were the tall icon-over-label kind, and were made compact.
