# 0147 — What arrived by email

**Status: built.** Every inbound message recorded, and a source marked
as receiving by the first one that does.

---

## Found on the first real message

An invoice was emailed to an address and rejected. The reason —
*"That address does not accept invoices"* — was correct: the source's
address was `null`, cleared before the domain was bound and never
recreated.

**The only place that reason existed was Cloudflare's own activity
log.** The operator found it because they were told where to look.

A supplier gets a clear bounce (decision 0146). **The customer gets
nothing**, and *"we never received it"* is a conversation they would
have blind.

---

## The case with nowhere else to be recorded

`intake_capture_events` already records every arrival **through a
source**, whether or not it succeeded (decision 0055).

**A message naming an address no source claims never reaches one.** So
it has nowhere to be recorded, and that is precisely the message
somebody will ask about — a supplier writing to an address that was
retired, mistyped, or never created.

`inbound_email_events` holds the whole story: sender, recipient, the
source where there was one, the outcome, and how many attachments
arrived against how many became invoices.

**The sender is the point.** Somebody chasing *"did our invoice arrive"*
has an address and a date and nothing else, and the capture path
discards `message.from` entirely.

---

## And the screen was about to start lying

`email_routing` has read `not_configured` since decision 0126 and
**nothing has ever set it**.

So the moment an address began receiving, the sources screen would say
*"Not receiving yet"* about it — **a lie on a screen, which is worse
than the placeholder it replaced.** The message was honest only while
it was also true by accident.

Set by the **first message that arrives**, rather than by somebody
remembering to. A routing rule is created in Cloudflare's dashboard and
this database cannot see it, so **a message arriving is the only honest
evidence that routing works.**

Not set when a message is rejected: nothing was delivered, so nothing is
proven.

---

## Recording never blocks receiving

`record` and `markReceiving` both swallow their failures. **Bouncing an
invoice because an audit insert failed would lose the document to
protect the note about it** — the same reasoning decision 0140 applied
to the privileged action log, and the same risk accepted deliberately
rather than by omission.

---

## Reasons are codes

`no_such_address`, `source_retired`, `no_attachment`, `unreadable`. The
words a person reads live in the control plane like every other string
(decision 0132), and a reason recorded in English here would be a reason
a German customer reads in English.

---

## What is not built

- **No screen shows it.** `GET /inbound-email` exists and the sources
  screen does not read it, so the answer is available to `curl` and not
  to the person who needs it.
- **Nobody is alerted.** A rejected message is recorded and still tells
  nobody in real time — the same gap decision 0125 puts behind email
  sending, now with a second example.
- **The routing rule is still made by hand.** Cloudflare's dashboard
  creates it and nothing in this system knows it exists, which is why
  `email_routing` has to be inferred from traffic rather than read.
- **A signature image is still an invoice** (decision 0146), and now it
  is a recorded one.
