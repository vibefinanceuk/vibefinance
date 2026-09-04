# 0083 — Where the interface lives, and how a person signs in

**Status: proposed.** Nothing built. The largest architectural decision
since the two-Worker split (0001), and written for review before code.

---

## The four questions, and how they resolved

`docs/HANDOVER.md` listed four questions before any UI could be written.
They are not independent — the second largely determines the fourth —
and answering them separately is how this kind of decision goes wrong.

They resolved in an order nobody expected: **SSO answered the identity
question, which answered the UI-location question, which answered
authentication.**

---

## 1. Customers have their own SSO, and that changes everything

Most customers have a SAML or OIDC identity provider. Accepting that has
three consequences that resolve problems this design was otherwise going
to have.

**A leaver is deprovisioned once, at source.** `org_users` stops being a
user directory and becomes a *projection*: a row that exists because
somebody authenticated, holding the roles **this instance** grants them.

**It argues for terminating SSO centrally.** If each instance Worker
terminates SAML, every customer does a metadata and certificate exchange
per region, and repeats it on every rotation. Terminating once means a
customer configures a single service provider however many instances
they have. That is a real difference in what is asked of a customer's IT
department.

**The machinery already exists.** `vf-licence` signs licence tokens with
ECDSA P-256 and every instance verifies locally with the public half —
no network call, with real forgery and tampering tests behind it
(Document 3, section 3). A session token is the same shape: assertion
in, signed token out, instance verifies locally.

> **This is not a second authentication mechanism.** The worry in the
> original question — that a session cookie would add a mechanism
> alongside the bearer token — dissolves. It is the mechanism already
> built, carrying a different claim.

---

## 2. Authentication in the control plane, authorisation in the instance

The distinction that keeps this honest.

| | Where | Why |
| --- | --- | --- |
| **Authentication** — who you are | `vf-licence` | One SSO configuration per customer, not one per instance |
| **Authorisation** — what you may do | The instance | A role granted in EU must not leak to US |

This preserves Document 3's stated constraint. `vf-licence` holds
customers, licences and aggregate counts — **never customer content**.
A user's identity passes *through* it and does not live in it: assertion
in, signed token out, and the instance maps to its own `org_users` row
by email.

### The session token is its own type

Not the licence token with extra claims. A licence token says *this
customer is entitled to X* and lives 48 hours; a session token says
*this person is authenticated* and should live minutes to hours. Same
crypto, same verification path, different claims and different TTL.

Overloading one token to carry both would make its lifetime a compromise
between two unrelated requirements.

---

## 3. One UI, not one per instance

Per-instance was the assumption and it does not survive SSO.

If a customer has EU and US instances and authentication is central,
**which UI does a user open to log in?** They would have to know their
region before authenticating, which is backwards: the point of central
SSO is to authenticate once and *then* discover what you can reach.

So: **one UI. The user authenticates, sees their instances, chooses
one.** The UI then calls that instance's API directly with its session
token — the CORS topology, now for a reason rather than a preference.

### Which changes white-labelling

Two halves, and they live in different places.

**The token layer lives in `vf-ui`** — the stylesheet, the CSS custom
properties, the components that consume them. That is
`docs/design/mockups/tokens.css` made real.

**The values do not**, because the UI is shared. Compiling Northwind's
teal into the bundle would mean a UI deployment to add a customer, and
every customer's branding in one artefact.

So the values are **fetched from `vf-licence`**. It already knows which
customer a user belongs to, it is what the UI talks to before any
instance is chosen, and — decisively — **the login screen needs branding
before an instance has been selected**, so an instance cannot be the
source for that moment.

### Branding is set by the operator, in `vf-licence`

Settled. A customer does not edit their own.

The alternative would need a scoped customer write path into the control
plane, where the admin key is currently operator-only and provisioning
is done by hand anyway (Document 3, section 7). Branding becomes a
provisioning-time activity alongside creating the customer and their
environments, which is where it naturally sits.

**The cost, stated:** a customer wanting their logo changed raises it
with the operator. With one live customer that is not a cost, and it is
reversible — a customer-facing branding editor could be added later
without moving where the values live.

This also keeps Document 3's constraint nearly intact. Branding is not
customer *content* in the sense that record meant, though it is the
first thing stored there that is not purely commercial.

---

## 4. A separate `vf-ui` Worker, not assets on `vf-licence`

Both are mechanically possible. A Worker serves static assets by
declaring a directory and optionally an `ASSETS` binding, and by default
serves a matching file first, running the Worker only when nothing
matches. Only one asset collection per Worker. (Workers Sites is
deprecated in Wrangler v4 and is not an option for new work.)

**The argument is deployment frequency, not capability.**

`vf-licence` is deliberately the small Worker with one job. Binding the
UI to it means **every UI change redeploys the component that mints
licence tokens for the entire fleet** — and UI changes are far more
frequent than control-plane changes.

A separate Worker costs a third deployment and a CORS configuration. It
buys a change surface that stays boring on the component whose whole
value is being boring.

> **An asymmetry worth naming.** Under this design, a `vf-licence`
> outage already blocks all logins fleet-wide. That is a genuine change
> from today, where it can be unreachable and every instance keeps
> working (Document 3, section 4). Existing sessions survive to their
> TTL, so the blast radius is bounded — but a component designed to be
> non-critical becomes critical for one operation.

---

## 5. One instance at a time, never merged

**Settled**, and it removes the hardest part of the multi-region design.

A power user with `Morrison-EU` and `Morrison-US` selects one from a
drop-down and sees that instance's organisations and data. They get
everything through one UI. **They never see two instances merged in one
visual.**

### Why that matters more than it sounds

Merging would have required one of two things, and both are bad:

- **Browser-side fanout** — the UI calls every region and concatenates.
  Workable for a list, and it falls apart for anything aggregate:
  "total value awaiting approval" needs every response before it means
  anything, and paginating two independently-ordered sources is
  genuinely awkward.
- **Server-side fanout** — something reads customer content from every
  region. That would be `vf-licence`, and it is exactly what Document 3
  says it must not do: *customers, licences and aggregate counts, never
  customer content*. Making the control plane a reporting proxy is a far
  larger change than making it an authentication service.

Choosing "never merged" means **neither is needed**. The UI holds a
session per instance and talks to one at a time; switching instance
switches which API it calls. Document 3's constraint stays exactly as
written.

> **The selector is a boundary, not a filter.** The temptation later
> will be to add "all instances" as an option, and that single option
> would reintroduce everything this decision avoids. Worth stating so
> nobody adds it as a convenience.

### Two consequences

**Aggregate numbers still cannot span regions.** No "total awaiting
approval across the group". If that is ever wanted, the honest route is
`usage_periods` — already pushed from each instance to `vf-licence` as
counts, with a payload deliberately incapable of identifying anything
(Document 3, section 5). Counts flow up; content does not.

**The selector belongs in the shell, not inside a screen.** It changes
which API the entire UI is talking to, so a stale selection is worse
than a stale filter: a queue that looks like `Morrison-EU` while showing
`Morrison-US` would be a dangerous confusion rather than an untidy one.

---

## 6. Widening the environments constraint

`UNIQUE (customer_id, kind)` becomes `(customer_id, kind, region)` —
one production per region, rather than one production.

Small, and worth doing deliberately: the existing constraint is what
currently stops a customer accidentally having two productions, and the
widened one still does within a region.

---

## 7. The identity provider is parked, behind a deliberate seam

**Settled: build without choosing.** SAML in a Worker means XML
signature verification and canonicalisation in a runtime with no Node
crypto; OIDC is roughly a day's work. Most enterprise IdPs speak both,
so the answer belongs to a real customer rather than to this document.

Parking it is safe **because almost nothing depends on it**:

| Does not care | Cares |
| --- | --- |
| The session token's format and TTL | One endpoint in `vf-licence` |
| Minting and local verification | |
| Branding storage and fetch | |
| The instance selector | |
| Every screen | |

OIDC means a redirect, a code exchange and JWKS verification. SAML means
receiving a POSTed XML assertion and verifying its signature. **Same
output, very different inside** — and everything downstream consumes *a
verified identity* without caring how it was obtained.

### The seam, stated so it is drawn deliberately

Everything downstream depends on **the session token**. Nothing depends
on how it was minted. That line is the whole reason this can be parked,
and it is easy to blur by accident — a screen reading an IdP claim
directly would tie the UI to a decision nobody has made.

### The stub, and why it is called a stub

Without an IdP there is still no way to sign in and test anything. So
the first implementation is a **dev-only endpoint that mints a session
token for a known user**, standing exactly where the SSO endpoint will.

That is genuinely useful and needs to be conspicuously temporary.
**"Temporary authentication bypass in the control plane" is precisely
the kind of thing that outlives its intent**, so it should refuse to run
against a production environment rather than relying on anybody
remembering to remove it.

---

## What already exists

More than expected:

- **`environments`** already carries `customer_id`, `kind`, `region`,
  `instance_url`, `worker_name` and `d1_database_name`. "Add an
  instance, declare its storage region" is largely modelled.
- **`environments.api_key_hash`** — a per-environment credential
  already.
- **ECDSA P-256 signing and local verification**, proven.
- **Fleet listing** (`handleListEnvironments`), which is most of "show
  me my instances".

---

## What blocked it, and no longer does

```sql
UNIQUE (customer_id, kind)   -- control-plane migration 0005
```

A customer could have **one sandbox and one production**. An EU
production *and* a US production violated it — the multi-region shape
this decision assumes was blocked by a constraint that predated the
idea, written when `kind` was the only thing distinguishing
environments, and correct then.

Section 6 widens it. Not built.

---

## What is not decided

- **SAML or OIDC — parked.** See section 7.
- **What happens to the per-user API keys** that `authenticateUser`
  checks today. They are how every live test in this project
  authenticates, and a session token does not obviously replace a
  service credential.
- **Session TTL**, and whether refresh exists.
- **Framework or hand-written HTML** — no longer blocking.
