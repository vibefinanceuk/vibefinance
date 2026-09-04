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

Branding can no longer be a per-Worker configuration file, because the
UI is shared. It has to be **fetched**: the UI asks which customer this
is and receives tokens back.

`vf-licence` already knows which customer a user belongs to, so it is
the natural source — and it is where a partner-versus-customer livery
would live if the product is ever resold. That is consistent with
`docs/design/operator-interface.md` section 7, which put the commercial
layer in the control plane.

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

## What blocks it

```sql
UNIQUE (customer_id, kind)   -- migration 0005
```

**A customer may have one sandbox and one production.** An EU production
*and* a US production violates it.

The multi-region shape this decision assumes is blocked by a constraint
that predates the idea — written when `kind` was the only thing
distinguishing environments, and correct then.

Widening it to `(customer_id, kind, region)` permits one production per
region, which matches the described model. Worth deciding deliberately
rather than as a side effect: it is the constraint that currently stops
a customer accidentally having two productions.

---

## What is not decided

- **SAML or OIDC.** SAML in a Worker is genuinely awkward — XML
  signature verification and canonicalisation, in a runtime with no Node
  crypto and a limited XML story. OIDC is dramatically simpler and most
  enterprise IdPs speak both. **Worth establishing what customers can
  offer before committing**, because this affects difficulty more than
  anything else here.
- **Framework or hand-written HTML.** Deliberately left open: it no
  longer blocks the architecture, and the mockups work either way.
- **Session TTL**, and whether refresh exists.
- **What happens to the per-user API keys** that `authenticateUser`
  checks today. They are how every live test in this project
  authenticates, and a session token does not obviously replace a
  service credential.
- **Whether the UI aggregates across instances.** The operator's
  position is that residency governs storage rather than access, so
  aggregation is permitted — but a queue view spanning regions is a
  different piece of work from a queue view of one.
