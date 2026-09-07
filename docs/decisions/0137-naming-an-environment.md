# 0137 — What a customer is asked, and what the system decides

**Status: built**, and smaller than it looked — see below. The signup form, the environment
naming scheme, and one guard that has to run at approval rather than
during provisioning.

---

## Three things, and only one is a question

### The kind is not asked

Provisioning creates `kind: "sandbox"`, hardcoded, and **that is
correct rather than an omission.**

Nobody trials in production. Decision 0118 provisions production as a
**second** environment when a trial becomes real, and a requester
choosing *"production"* on a signup form would be choosing before they
have seen the product.

**Offering the choice would be offering a mistake.**

### The region is asked, and is not asked today

`region: "eu"` is also hardcoded, and this one has **no reasoning
recorded anywhere** — it is a default that became a decision by nobody
noticing.

Decision 0084 made a customer able to hold environments **per region**,
so it is a real dimension. A German customer whose invoices land in `eu`
is right; an Australian one is not, and nobody has asked them.

**EU or US on the signup form.** The requester knows and we would be
guessing.

### The name is decided by the system

`{customer}-{kind}-{region}` — `acme-sandbox-eu`, then
`acme-production-eu` when they go live, `acme-production-us` if they add
a region.

Readable, distinct, and it needs nobody to invent an identifier — the
same reasoning decision 0128 applied to source names, and decision 0126
to email addresses. **A person configuring a system should not be naming
things nobody will ever type.**

---

## Where `acme` comes from

Today the operator supplies `customerId` in the provision request,
separately from `company_name` on the form. So *"Acme Ltd"* becomes
`acme` because a person decided it did.

**Derive it, and let the operator override.** Decision 0129 already has
the slug rules, including folding accents so *"Großkunden GmbH"* becomes
`grosskunden-gmbh` rather than something unreadable.

The override matters: a company name is not always what belongs in a
hostname, and the operator is the one who has spoken to them (decision
0038).

---

## The length guard, and where it must run

**`International Business Machines Corporation`** slugs to 43
characters. Add `-production-eu` and it is 57.

Cloudflare's limits on D1 and Worker names are around 64, so a long
company name gets close enough to matter — and **the failure would
arrive mid-provisioning, after the database exists**, which is exactly
the half-created customer decision 0135 orders its steps to avoid.

So it is checked **at approval**, with a reason, before anything is
created. The same lesson decision 0129 learned on the email local part:
a name that cannot become an identifier should be refused while somebody
can still change it.

The check must account for the **longest** name a customer will ever
need, not the one being created: an `acme-sandbox-eu` that fits while
`acme-production-eu` would not is a customer who cannot go live.

---

## What this does not disturb

**Email addresses.** Decision 0126 derives them from the **customer**,
not the environment — `ap-mailbox.acme@vibefinance.com` — precisely so a
customer keeps their address when decision 0118 moves them to
production.

This scheme changes environment names and leaves addresses alone, which
is the property that made 0126 choose the customer in the first place.

---

## Built, and one thing already was

**`handleCreateEnvironment` has named environments
`{customer}-{kind}-{region}` since decision 0084.** The scheme this
record proposed is what it has always done, and only provisioning's own
placeholder URL used a different shape.

So the naming needed nothing. Left where it lives rather than
duplicated: **a second place computing the same name is a second place
for it to drift.**

What did need building:

- **`region` on `signup_requests`**, and provisioning reading it —
  falling back to `eu` for a request made before the form asked, because
  inventing an answer is wrong and so is refusing somebody who applied
  before the question existed.
- **`customerIdFrom`**, sharing decision 0129's slug rules including the
  accent folding.
- **The length guard at approval**, watched to fail: checking the
  sandbox name rather than the production one lets through a customer
  who cannot go live.

---

## Deliberately not decided here

- **Which regions exist.** EU and US because they are the two anybody
  has asked for. Decision 0084's binding-per-region model supports more,
  and each is a real deployment rather than a dropdown entry.
- **Whether a customer can move region.** They cannot today, and a
  second environment in a new region is not the same as moving.
- **What happens to a customer whose company name changes.** The
  identifier is derived once at approval and does not follow — which is
  right, since it is in every environment name and every email address,
  but it means the two can drift apart in a way nobody is told about.
