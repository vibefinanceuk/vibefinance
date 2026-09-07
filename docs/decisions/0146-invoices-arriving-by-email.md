# 0146 — Invoices arriving by email

**Status: the handler is built.** A source with an address can receive,
once a Cloudflare Email Routing rule points at it — **and no rule exists
yet.**

---

## What was missing

A source has carried an address since decision 0126, `vibefinance-ai.com`
was bound on 7 September (decision 0141), and **nothing delivered to
one**. The sources screen has said *"Not receiving yet"* for two days,
honestly.

Two halves. The **handler** — what a Worker does when a message arrives
— needs no Cloudflare API and is built here. The **routing rule** does,
and is not.

---

## It runs in the customer's own Worker

Decision 0125 settled this and it is worth restating, because it is the
whole shape: **a shared receiver would put every customer's invoice
through the same code on its way in**, which is exactly what decision
0091's split exists to prevent.

A routing rule names one address and one Worker. Another customer's mail
never touches this code path.

### Which makes `resolveTenant` inapplicable, for the first time

Decision 0001's lint rule objects to reading `env.DB` directly, and it
is right to: doing so commits to one-Worker-per-tenant.

**That commitment is already made, and this is where it becomes
visible.** `resolveTenant(request, env)` needs a *request*, and an email
handler has none — so the binding **is** the tenancy, which is the
reason a rule names one Worker in the first place.

Exempted with the reason, in one place, rather than by relaxing the
rule.

---

## Nothing is silently dropped

Decision 0125's own words: *"a supplier who sent an invoice believes
they sent it."*

Every refusal calls `setReject`, which returns a bounce the **sender**
sees. That is the difference between a supplier learning today and a
customer learning in a month that invoices went nowhere.

| What arrived | What happens |
| --- | --- |
| An address no source claims | Bounced. A rule outliving its source is the shape decision 0130 warned of. |
| An address whose source is **retired** | Bounced. **This is what makes the status true** rather than decorative, until retiring also removes the rule. |
| No attachment | Bounced, saying what to attach. |
| Nothing readable | Bounced. |
| One good attachment and one broken | **Captured.** An invoice arrived; asking the supplier to resend it would be wrong. |

---

## Attachments only, and that is a decision

A supplier who pastes an invoice into the body has sent something this
system **cannot retain** — there is no file, and decision 0055's whole
intake model rests on keeping what arrived.

Capturing the body as a text document would produce something nobody can
audit against. Bouncing is honest.

**Every attachment, not the first.** Three invoices in one message are
three invoices, and picking one loses two silently.

---

## The MIME parsing is deliberate, and thin

`EmailMessage` gives a stream and nothing else. A MIME library would be
a dependency this needs one function from, in a Worker where decision
0089 already records a dependency failing the deploy while passing both
test suites.

So: the boundary, the parts, `Content-Type` against a list of what an
invoice arrives as, and base64 — **the only encoding worth handling**,
since a PDF sent as anything else did not survive the journey.

**A part that will not decode is skipped, not thrown.** One bad
attachment must not lose the others.

---

## What is not built

- **The routing rule.** Until one exists, this handler receives nothing.
  It needs the Cloudflare API — the credential decision 0135 gave real
  thought to, and the same reason provisioning is a script the operator
  runs.
- **`email_routing` still reads `not_configured`** for every source, and
  nothing sets it. When a rule is created, that column must follow or
  the screen will keep saying *"Not receiving yet"* about an address
  that receives.
- **A signature image is an invoice.** A logo in a footer arrives as an
  attachment of a capturable type, and becomes a task in front of
  somebody. Nothing distinguishes them.
- **Nobody is told a message bounced.** The supplier is; the customer is
  not, and *"we never received it"* is a conversation they will have
  without knowing why.
- **The sender is not recorded.** `message.from` is known at capture and
  discarded, where it is exactly what somebody chasing a query wants.
