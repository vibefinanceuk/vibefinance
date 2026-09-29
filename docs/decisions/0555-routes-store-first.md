# 0555 — Routes, slice 1: every email stored before it is read

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app` only, and needs **`vf-app` migration `0106` (apply
before deploying `vf-app`)**. No `vf-ui` or `vf-licence` change: nothing
changes on screen.

## What was asked

The operator agreed the Routes design (a Claude Doc, *"VibeFinance —
E-invoicing, Peppol, AR and Integration: Design"*) and its phase 1 data
model (`docs/design/routes-phase1-data-model.md`), and asked for slice 1,
"store first". The operator added a constraint: **D1 for data, R2 for
documents**, each used for what it is good at, so the capacity Cloudflare
provides goes where it is meant to.

## What was decided

- **Every email a Source receives is a route message** (migration `0106`:
  `route_messages`, `route_message_parts`, `route_message_events`,
  `route_message_items`). Its id is a reference a person can read out:
  `MSG-7F3A-2291-0C4E`.
- **Stored before it is read.** The whole email (`message.eml`, part 0) is
  put in R2 first, then each PDF, XML or image attachment as its own
  object (parts 1, 2, …). Only then is anything detected or extracted.
  Until now a document was kept only once an invoice existed for it
  (0068), so a message that failed before that point left nothing.
- **D1 holds what happened; R2 holds the bytes.** D1 rows are small:
  sender, subject, status, which part failed and why, and each part's
  name, type, size, SHA-256 and R2 key. No file, rendering or extracted
  text goes into D1.
- **Each file stored once.** When an attachment becomes an invoice, its
  `invoice_documents` original points at the attachment's own R2 object
  (`referenceStoredDocument`) instead of uploading it again under the
  invoice's key. `invoice_documents` gains `route_message_id` and
  `part_seq`. The only new bytes are the email itself. The content type on
  the invoice document is still detection's (0069), so the viewer serves
  it as before.
- **Keys**: `{customer}/routes/{source}/{yyyy}/{mm}/{message}/{seq}-{file}`,
  under the customer beside the invoices, so the bucket's jurisdiction
  (0033) and retention report (0077) cover them. By month of arrival,
  since a message may never yield an invoice date.
- **Outcomes**, with the part that failed:

  | What happened | Status | Failed part |
  | --- | --- | --- |
  | Every attachment became an invoice | `delivered` | |
  | Some did, some did not | `partial` | |
  | None could be read | `failed` | `translation` |
  | Nothing attached | `failed` | `format` |
  | The source is retired | `failed` | `gateway` |
  | No source claims the address | `failed` | `gateway` |

  Each attachment records `captured` or `failed` with the capture's own
  reason, and each invoice made is a message item. The history records
  received, original stored (or not, and why), captured or capture
  failed per attachment, and the outcome.
- **`partial` is new to the design note**, which had no word for "one of
  two attachments failed". Bouncing such a message would ask the supplier
  to resend the good one (0146), so it is not `failed`; calling it
  `delivered` would hide the bad one from IT.
- **Mail to an address no source claims is recorded but not stored.** It
  belongs to no process, so no retention rule covers it, and keeping it
  would make the bucket a sink for anything mailed to any address.
- **Bounces are unchanged.** A supplier whose invoice could not be read
  still hears at once (0125). The difference is that the customer now
  has the message and its original.
- **Recording never stops receiving.** Every write to the new tables
  catches its own failure. Without R2 (or without `CUSTOMER_ID`) the
  message is still recorded, with "original not stored" and the reason,
  and capture stores the invoice's own copy as before. If one part cannot
  be stored, capture takes the old path for that attachment.
- **`instance_id` names a source for now** (a foreign key to `sources`).
  Route instances arrive in slice 3, and each source becomes an instance
  with the same id, so these rows need no change then. `route_id` and
  `route_version` stay empty until then.
- `inbound_email_events` is still written as before, for the existing
  arrivals list.

## Not built / worth knowing

- **Nothing shows these messages yet.** The Route monitor is slice 2. Until
  then they can be checked with the queries under Verification.
- **Only email** is recorded. The HTTPS capture route (`/sources/:id/capture`)
  is not yet a route message.
- **Reprocess** is slice 5. The stored parts are what it will run from.
- **Earlier email is not backfilled.** Its originals were never kept.
- **A message larger than R2 will take in one `put`** is not a concern:
  Cloudflare caps inbound mail at 25MB.
- An R2 failure is recorded, not retried. The design note mentioned a
  temporary rejection so the sender's server retries; an email Worker's
  `setReject` is a permanent bounce, so that is not possible here and the
  message is processed as before instead.

## Verification

- **`vf-app`** `route-messages.test.ts` (14):
  - delivered, with sender, recipient, subject and a readable reference;
  - the email kept in R2 byte for byte, with its size and SHA-256;
  - each attachment its own object, with its outcome;
  - the invoice's original points at the attachment's object, the viewer
    still serves it, and there is no second copy;
  - the history in order;
  - nothing attached: `failed` at the format, the email (and its body)
    kept, the supplier told;
  - nothing readable: `failed` at the translation, the attachment kept
    with its reason;
  - one good and one bad: `partial`;
  - a retired source: `failed` at the gateway, the email kept;
  - an address nothing claims: recorded, nothing stored;
  - without R2: recorded, captured as before, "original not stored";
  - safe file names, keys and references.
- With the previous production files, **all 11 behaviour tests failed**
  (the 3 for keys and references test the new module alone).
- `inbound-email`, `source-email`, `source-capture`,
  `source-capture-workflow`, `document-storage`, `capture-pdf`: 144/145,
  the one failure the known `capture-pdf` "writes the corrected value
  back" (0511).
- Migrations: `vf-app` replay 106, all assertions held.
- **`vf-app`**, a full, unfiltered run: 135 files and 3228 tests, of which
  **3226 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
- **After deploying**, send an invoice to a Source's address and check:

  ```
  npx wrangler d1 execute vf-app-poc --remote --command "SELECT id, status, failed_part, error_code, subject FROM route_messages ORDER BY received_at DESC LIMIT 5"
  npx wrangler d1 execute vf-app-poc --remote --command "SELECT message_id, seq, role, filename, bytes, outcome, r2_key FROM route_message_parts ORDER BY stored_at DESC LIMIT 10"
  ```
