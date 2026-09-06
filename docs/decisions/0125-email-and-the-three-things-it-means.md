# 0125 — Email, and the three things it means

**Status: designed, not built.** An evaluation, and an order.

---

## Three problems that share a word

The operator named three needs. **They differ on every axis that
matters**, and building one framework for all three would be the
mistake.

| | Supplier contacts | Users | Sources |
| --- | --- | --- | --- |
| Direction | **Out**, to strangers | **Out**, to colleagues | **In** |
| Where the address comes from | An import, or a person | Sign-in, already trusted | The customer chooses it |
| Cost of getting it wrong | An invoice query reaches **another company** | A colleague misses a task | Invoices arrive nowhere |
| What exists today | **Nothing** | `org_users` | `mechanism: 'email'` and no address |

The third is not email *sending* at all. It is an intake transport that
happens to use SMTP, and grouping it with the other two would make a
notification system responsible for receiving invoices.

---

## Sources: an address, and a way in

A source has a `mechanism` of `'email'` and **no address**. Decision
0111 gave it a `default_org_unit_id`, which is exactly the association
the operator described — *"instantiating a source by Org which can be an
email"*.

So the org part is built and the email part is a column and a transport.

**Cloudflare Email Routing delivers to a Worker**, which is the plumbing.
The design questions are the ones a customer will ask:

- ~~**Which domain?**~~ **Settled: a VibeFinance domain.** No customer
  DNS to arrange, nothing to go wrong in somebody else's zone, and an
  address that works the moment a source is created. The cost is that
  it reads as ours rather than theirs — acceptable, and reversible: a
  customer's own domain can be added later as a second option without
  changing how a source works, because the source owns the address
  either way.
- **How does a customer get an address**, and can they have several?
  They should: decision 0060's whole point is that "AP mailbox" and "AR
  mailbox" are different sources sharing a mechanism.

### And it must not be routed through a shared component

The operator's requirement, and it settles the shape:

> Each customer also does not want their traffic routed with other
> customers' traffic. It might need to be isolated for that reason.

**This is the architecture's central invariant, not a preference.**
`vf-licence` is a single shared Worker *precisely because* it holds only
customers, licences and counts, and never an invoice (decision 0091). A
shared email receiver would break exactly that: every customer's invoice
passing through the same code on its way in.

An earlier version of this record proposed a **registry in
`vf-licence`** mapping address to environment. That is fine as *data*
and wrong as a *receiver*, and the distinction was not obvious until the
isolation requirement made it so.

**Cloudflare Email Routing rules are the registry.** A rule matches an
address and delivers to a Worker — so `invoices.acme@vibefinance.com`
routes **straight to Acme's own `vf-app`**. Another customer's mail
never touches Acme's code path, and Acme's never touches theirs.

Better than the registry on every count:

- **No shared component sees content**, which is decision 0091's line
  held rather than bent.
- **No registry to keep in step** with the instances — Cloudflare holds
  the rule, and there is one place it lives.
- **The address survives going live.** Decision 0118 provisions a second
  environment for production; repointing one rule moves the address to
  it, and **no supplier is ever told a new one**. That was the whole
  reason for suggesting a registry, and this gets it for free.

**The cost is real.** Provisioning must create an Email Routing rule
through the Cloudflare API — the half of decision 0039 that is not
built, which currently stops at control-plane rows and reports
`infrastructureProvisioned: false` rather than pretending. **An
address becomes another thing that only works once provisioning can
call Cloudflare**, alongside the D1 database and the Worker itself.
- **What happens to a message for an address nobody configured?**
  Silently dropped is wrong — a supplier who sent an invoice believes
  they sent it.
- **And what is an attachment versus the body?** A supplier who pastes
  an invoice into the message rather than attaching it has still sent
  one.

**Smallest of the three, and the one customers actually want**: invoices
arriving by email rather than by `curl`.

---

## Users: three columns and one decision

`org_users` holds `id`, `email`, `name`, `unit_id`, `locale`.

Splitting `name` into first and last is a migration and nothing more —
worth doing, because *"Dear Dan"* and *"Dear Dan Young"* are different
letters and only one is right.

**"Role" is the part worth pausing on.** Roles already exist as a real
model: `org_roles`, `org_user_roles`, and permissions namespaced by
category (decision 0010). A free-text `role` column beside them would be
**a second truth about the same person**, and the two would disagree
within a month.

**Settled: a job title.** *"AP Clerk"* — descriptive, for a signature,
a directory, or the line under somebody's name in a task list.

Which means it must **never be read as authority**. A `job_title` column
beside `org_user_roles` is only safe while nothing consults it to decide
anything: the moment a rule or a route tests it, there are two answers
to *"what may this person do"* and they will disagree.

Named `job_title` rather than `role` for exactly that reason. **A column
called `role` sitting next to a roles table is an invitation**, and the
name is the cheapest guard available.

---

## Suppliers: a master, an import, and a contact model

**Nothing exists.** No supplier table, no contacts, no import. A
supplier is a VAT identifier printed on a document.

The operator's shape:

> Each supplier record should have a contact email address... Each
> supplier may have multiple users, these are additional contacts, with
> role and email information. The supplier contact may be the contact
> for one or many invoices.

That is three tables — supplier, contact, and a reference from an
invoice to a contact — and it is **the largest of the three by a
distance**.

### The document will not supply the contact

Worth stating, because it looks like it should. BT-34 is the seller's
**electronic address** — a Peppol participant identifier, the endpoint a
document was routed from. It is almost never a mailbox a person reads.

So contacts come from **an import or a person typing them**, which is
where decision 0117's supplier spreadsheet lands. The supplier *record*
can spawn from documents (0117); its *contacts* cannot.

### And a contact per invoice is a real requirement

*"The contact for one or many invoices"* means an invoice can name which
contact a query goes to — not just "the supplier's address". That is a
column on the invoice, and a default on the supplier when it names none.

---

## What all three share, and nothing has

**A single place that sends**, with a record of what was sent, to whom,
and what failed.

Worth building **once, with the first of them**, rather than three
times. It needs:

- A provider, and the credentials held as a secret (decision 0006's
  pattern).
- **A record of every send.** An invoice returned to a supplier is a
  business event; *"we told them"* has to be answerable later, and
  `intake_capture_events` is the precedent.
- **An answer for failure.** A password link nobody receives is an
  onboarding that silently stops (decision 0117). This is the same shape
  as the fail-open licence cache: what does the system do when the thing
  it depends on is unreachable, and does anybody find out?
- **Where it lives.** The control plane sends password links and expiry
  warnings; an instance emails a supplier about a returned document.
  Those are different senders with different data, and decision 0091's
  line — the control plane never holds customer content — applies.

---

## The order, and why

1. **The sending mechanism**, with the first thing that uses it.
2. **Sources**, because the org association exists, it is self-contained,
   and it is what a customer notices.
3. **Users**, which is a migration and a decision about the word "role".
4. **Suppliers**, which is a master, an import and a contact model — and
   which decision 0117 already needs for onboarding.

**Not the order of value.** The administrator's password link (0117)
blocks onboarding entirely and belongs with step 1, because it is the
one email without which nothing else can be reached.

---

## Deliberately not decided here

- **The provider.** Cloudflare has no first-party sending; Resend,
  Postmark and SES are the usual candidates and none has been evaluated.
- **The address format**, now that the domain is settled. Whether a
  customer picks the local part, and what happens when two want the
  same one — **uniqueness is now enforced by Cloudflare**, since two
  rules cannot match one address, but a customer being told *"that
  address is taken by somebody you have never heard of"* is a worse
  answer than a scheme that cannot collide.
- **The other mechanisms.** Only email arrives at a shared front door
  with nothing saying who it is for, which is why only email needs
  routing at all. **HTTPS already resolves**: one Worker per customer
  (decision 0001) means a `POST` to `/sources/:id/capture` has arrived
  at the right instance and the URL *is* the routing. File import is a
  signed-in person. **SFTP and EDI are genuinely unknown** — Workers
  does not do SFTP, so that mechanism needs something else listening,
  and whether it needs routing depends on what.
- **Fleet visibility.** *"Where can documents arrive for this
  customer?"* is a real operator question and **not a routing one**. It
  belongs with decision 0039's fleet metadata as a report, not as a
  second table of sources that would drift from each instance's own.
- **Whether templates live in D1 like `ui_strings`** (decision 0107) or
  in code like the code lists (0113). The test is the same one that
  settled those: **is this wording ours to change, or the standard's?**
  Email wording is ours, which points at D1.
- **Inbound attachment handling** — size limits, what to do with five
  attachments, and whether a body counts as a document.
- **Bounce and complaint handling.** A supplier address that hard-bounces
  is stale data a customer should be told about, not a silent failure.
