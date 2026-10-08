# 0687: An emailed message is accepted at once and read later; the same email is read once

**Status: built**, in bundle 0985 on top of `487b982`. vf-app migration
`0149_inbound_read_later.sql`; vf-licence migration `0305_inbound_read_later_strings.sql`.

## What was asked

Dan, 8 October 2026:

> I have noticed that the Route monitor seems to report multiple tries, and
> eventually creates multiple copies of the same invoices in the workflow
> process. Before I resubmit, could you investigate why that might be the case?

and, after the findings: "Build both parts".

## What the Route monitor showed

Read through the app's API in Dan's signed-in browser:

- The same email arrived every **5 min 10 s** (10:25:31, 10:30:41, 10:35:52,
  10:41:40, 10:46:51; and 11:20:36 to 12:09:26). The stored `message.eml` had the
  same sha256 each time.
- No copy had `completedAt`. Each stopped part-way: the 10:25 copy made four
  invoices and never reached the fifth PDF; the 10:30 copy reached the fifth.
  They sat "In Process" until Dan dismissed them.
- One scanned two-page PDF took four minutes to read (10:25:42 to 10:29:44).

## Why

The email handler read every attachment, model calls included, before it
returned. The sending server waits for that answer; with five scanned PDFs it
never came, so the sender counted the delivery as failed and sent the email
again. Nothing knew it was the same email, so each copy was a new Route monitor
message and made the invoices again.

## The fix

### 1. Accept now, read later

- `handleInboundEmail(..., { readLater: true })`, as `email()` in `index.ts`
  now calls it, stores the email and every attachment in R2, sets
  `read_queued_at`, records a `queued` event, and returns. The sender gets its
  answer in seconds.
- Refusals that need no reading still bounce at once: an address no source
  claims, a retired source, no attachment.
- If any attachment could not be stored, the message is read inline as before,
  because the reader works only from stored copies.
- `readQueuedInbound` (`inbound-read-later.ts`) runs last on the existing
  five-minute cron (`*/5`). For each queued message it:
  - **claims it with a lease** (`reading_until`, 10 minutes), renewed before each
    attachment, so two runs never read one message;
  - reads only attachments with no outcome that have made no invoice, so a run
    cut short is picked up by the next;
  - starts no new attachment after 6 minutes, well inside the cron's 15;
  - fails an attachment that throws, with the error;
  - after `MAX_READS` (3) claims that never finished, fails what is still unread
    ("not read after 3 tries") rather than retrying for ever;
  - settles the message as receiving would (delivered, partly delivered or
    failed), writes the `inbound_email_events` row, marks the source receiving,
    and calls the 0559 alerts.
- Only messages with `read_queued_at` are picked up, so nothing received before
  this change is read again by surprise.
- Reprocess is refused (`being_read`) while the lease is held, and holds the
  lease itself while it runs.

### 2. The same email is read once

- `emailIdentity`: the email's `Message-ID` header, else `sha256:` of the raw
  message. Stored as `route_messages.email_message_id`.
- A second delivery to the same source with the same identity adds a
  `received_again` event to the first message and is accepted without reading.
  The sender stops, and no invoice is made twice.
- A different email carrying the same PDFs (a supplier re-sending on purpose,
  or Dan forwarding again) has its own Message-ID and is read as new.

### What changes for a supplier

An attachment that cannot be read no longer bounces back to the sender: by the
time it is read, the email has been accepted. It shows as failed in the Route
monitor, and the route's alerts (0559) say so.

## Route monitor words (vf-licence 0305)

`routemonitor.event.queued`, `received_again`, `read_resumed` and
`read_given_up`, in English and German.

## Tests

- `test/inbound-read-later.test.ts` (10):
  - accepted without reading;
  - read and settled on the next run, and read only once;
  - stopping for time and carrying on;
  - a leased message left alone and refused for Reprocess;
  - giving up after three runs;
  - an old message is never picked up;
  - no attachment still bounces;
  - the same Message-ID read once;
  - the same bytes with no Message-ID read once;
  - a different Message-ID read as new.
- `route-fix.test.ts`: the three-failures alert test now sends three distinct
  emails, as three real failures are.
- Full vf-app run: 3728 passed. The three failures are known and unrelated.

## Deploy

1. Apply vf-app migration 0149.
2. Apply vf-licence migration 0305.
3. Deploy vf-app and vf-licence.

After that, an emailed invoice appears within about five minutes, on the next
cron run, rather than while the sender waits.
