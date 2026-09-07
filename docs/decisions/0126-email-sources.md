# 0126 — An address invoices can arrive at

> **Superseded in part by decision 0141.** `INGESTION_DOMAIN` was
> hardcoded to `vibefinance.com`, **which nobody owns** — so every
> address described below as *reserved* was a string that could never
> receive anything. The domain is configuration now, and an unset one
> refuses to issue an address at all.

**Status: built** — the address, the route, and the first configuration
screen. **Not built:** the Cloudflare routing rule, so nothing delivers
to an address yet.

---

## The address names the customer, not the environment

A source has carried `mechanism: 'email'` since decision 0060 and **no
address**, so *"this customer receives invoices by email"* has been a
statement of intent.

The local part is **`<name>.<customer>`** — `ap-mailbox.acme@vibefinance.com`.

**The customer rather than the environment is the whole point.**
Decision 0118 provisions a *second* environment when a trial becomes
production, and an address naming the sandbox would have to be reissued
to **every supplier** on the day a customer goes live. A customer id is
stable across both.

Fleet-uniqueness follows without a registry, because a customer id is
unique across the fleet and the address contains it.

### Generated, not chosen

A customer picking a local part would collide with another customer they
have never heard of, and *"that address is taken"* is an answer nobody
can act on. Deriving it from their own id cannot collide.

The screen says so **by asking for nothing**: a button, no field.

### And never reissued

Suppliers write an address down. Changing it silently would break every
one of them, so a second attempt is refused with the reason.

---

## Honest about the half that is not built

`email_routing` is `not_configured`, and the screen reads **"Not
receiving yet"**.

Creating the Cloudflare Email Routing rule needs the API half of
decision 0039, which stops at control-plane rows today. So an address
can be **reserved before anything can deliver to it** — and saying so is
the same discipline as `infrastructureProvisioned: false`.

**A screen implying mail was arriving would send somebody to tell their
suppliers an address that swallows invoices.** That is worse than a
screen admitting it is not ready.

The wording is for the reader rather than the column: *"Not receiving
yet"*, not *"not configured"*. The person wants to know whether to tell
their suppliers.

---

## Three standing invariants

- **Only an email source has an address.** An SFTP feed carrying a
  mailbox is a configuration nobody could act on, and a report of
  *"where can documents arrive"* would read it as real.
- **Routing is never claimed without an address**, or an operator is
  told mail is arriving somewhere nobody can name.
- **An address is lower-case.** A local part is case-sensitive by RFC
  5321 and case-*insensitive* in every practical mail system, so two
  casings would make the unique index enforce nothing.

---

## The first configuration screen

Everything a customer has configured so far has been `curl` — fine for
an operator, and not for the administrator decision 0117 gives them.

**The navigation has a second entry**, at last. The frame has carried
one since decision 0108, which existed precisely so later screens would
sit inside it rather than be retrofitted into it. This is the first of
them.

**No router, and no history.** One screen has existed until now, so a
URL scheme would be a guess at what the second and third want. A
function call is honest about that, and the day the back button matters
is the day to design it properly.

---

## Two things found on the way

**`requirePermission` takes an API key only** — and 28 configuration
routes use it, against 10 that accept a session. So a signed-in
administrator cannot reach almost any configuration route.

The two this screen needs now accept sessions. **The rest are recorded
rather than fixed in passing**: `requirePermission` does not receive the
public key or the environment id, so making it session-aware means
threading two arguments through 28 call sites. That is decision 0105's
territory and a decision of its own.

**And `el()` was defined twice**, privately, in `tasks.js` and
`viewer.js`. A third screen would have been a third copy — two
definitions of what an element is, one of them eventually drifting. Now
exported once.

---

## What is not built

- **The routing rule**, and therefore actual receipt. Everything here is
  reservation.
- **Creating a source** from the screen. It lists what exists and gives
  an address to an email one; the source itself still comes from `curl`.
- **What arrives.** Attachment handling, size limits, whether a message
  body counts as a document, and what happens to mail for an address
  nobody configured — which must not be silently dropped, because a
  supplier who sent an invoice believes they sent it.
