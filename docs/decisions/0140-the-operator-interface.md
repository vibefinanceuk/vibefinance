# 0140 — The operator interface, and who did what

**Status: the attribution is built; the interface is not.**
`admin_actions` records every privileged action, refusals included, and
the identity comes from a verified Access assertion where one exists.

The screen waits on a domain — Cloudflare Access applies policies to
hostnames in a zone, and `workers.dev` is not one (decision 0141).

---

## What is being asked for

> A `vf-licence` UI, for my own administrative user, where I can view
> instances provisioned, and reject and approve requests for
> provisioning that have come in.

**The API is complete.** Listing requests, approving, rejecting,
provisioning, listing customers — all built, all reachable, and none of
it has a face. Approving a customer is a `curl` today, and **a decision
made blind is a checkpoint in name only** (decision 0038).

---

## A fourth Worker, not a section of an existing one

### Not `vf-ui`

That Worker is loaded by **every customer's browser**, and its proxy has
a deliberate allow-list that **refuses admin paths outright**, with a
test asserting it (decision 0102). Adding operator routes would undo a
guard that exists precisely because the admin key can create customers,
issue licences and mint credentials for anybody.

### Not `vf-licence` either

Decision 0099 made this argument for the customer UI, and it holds more
strongly here: binding an interface to `vf-licence` means **every UI
change redeploys the component that mints licence tokens for the whole
fleet**.

An admin tool is used by one person and iterated on freely — exactly the
thing that changes often. `vf-licence` should change rarely.

`vf-licence` is also already touched by every customer's browser:
`/login`, `/branding/:id` and `/ui-strings` all arrive from sign-in
screens. Operator assets behind that same front door would be protected
by routing alone.

### So: `vf-admin`, bound by a Service Binding

Decision 0005 found the hard way that a Worker calling `vf-licence` by
its `workers.dev` URL is **silently blocked by Cloudflare's own
anti-loop protection** — the request never arrives. A Service Binding,
as `vf-app` already uses.

---

## Authentication is the easy part

**Cloudflare Access** in front of the Worker: a policy naming the
operator, authenticating against an identity provider, refusing
unauthenticated requests **before they reach the Worker at all**.

No login screen, no session handling, no operator credentials in
`CONTROL_DB`, and none of decision 0090's progressive delay to build a
second time. For an internal tool with one user, building a complete
second authentication system would be disproportionate.

**Three things it must be configured with**, and each is a control
rather than a preference:

- **MFA at the identity provider.** An emailed one-time code is
  single-factor — possession of an inbox. ISO 27001 **A.8.5** wants more
  for privileged access.
- **A short session.** Access defaults are generous; a privileged
  session outliving a working day is a finding.
- **A named policy**, not "anyone in the account". **A.8.2**:
  privileged access allocated on a need-to-use basis.

### And the Worker must not trust the route alone

Access protects the *route*. If the policy is misconfigured, or the
Worker is reached another way, **the admin key is simply there**.

`vf-admin` verifies the `Cf-Access-Jwt-Assertion` header — signed by the
team's own key — and refuses without it. Belt as well as braces, and a
few lines rather than a system.

---

## The attribution problem, which is the real work

`vf-licence` records `decided_by` on a signup request, and **it is
whatever the caller says.** The reasoning is already written down
honestly in `signup-route.ts`:

> `ADMIN_API_KEY` is a single shared secret, so `vf-licence` genuinely
> cannot tell which individual is acting. If per-operator identity ever
> matters here, it needs real per-operator admin credentials first —
> recording an invented value in the meantime would be worse.

That was right for one operator with `curl`. **It fails ISO 27001
A.8.15 and SOC 2 CC7.2**, which require privileged actions to be
*attributable* rather than merely recorded — and an approval affects a
customer's financial system, which brings SOC 1 in as well.

**`vf-admin` holding the admin key makes it worse**, not better: every
action would be attributed to a Worker, and a self-declared `decidedBy`
is a field an auditor discounts entirely.

### So the identity comes from Access, verified

`vf-admin` extracts the email from the **verified** JWT and passes it to
`vf-licence`, which records *that* — not a value the caller chose.

This is exactly the discipline decision 0010 already applies in
`vf-app`: *who confirmed a worked example is read from the authenticated
caller, never from a client-supplied field*, proven by a test that sends
a spoofed identity and confirms it is ignored.

**The control plane has been the exception.** This ends it.

---

## Logging every privileged action

`decided_by` covers **two routes**. Seven are admin-gated:
`/signup-requests`, `/customers`, `/environments`, `/licences`,
`/credentials`, `/access`, `/ui-strings`.

Creating a licence, minting a credential, granting somebody access to an
environment — none records who did it. **A.8.15 asks for all of them.**

An `admin_actions` table in `CONTROL_DB`: who, what, which object, when,
and the outcome. `intake_capture_events` is the precedent — decision
0055 records every arrival whether or not it succeeded, and the same
argument applies here.

**Written by the route, not by the caller.** A log a caller can shape is
a log an auditor discounts.

### And the operator cannot quietly erase it

Append-only, with no delete route. Not tamper-*proof* — somebody with
direct database access can do anything — but tamper-**evident** in the
ordinary path, which is what the controls ask of a system of this size.

---

## Built, and two things it deliberately does

**Recorded at the edge**, in the wrapper that already applies CORS to
whatever the router produced. Seven route groups are privileged and two
recorded who acted; a convention asking each route to log itself would
have had the same shape, **and the eighth would be the one that
forgot**.

**The gate and the log ask one question.** `isPrivileged` was an
expression inside the router; the audit needed it too, and a second copy
is a second thing to keep in step. Extracted, exported, and tested from
both sides.

### Refusals are the interesting half

*"Did anybody try to provision a customer we rejected"* is the question
an auditor asks, and **a log of successes cannot answer it.** Decision
0055 made the same choice for intake: every arrival recorded whether or
not it succeeded.

An attempt with **no credential at all** is recorded too, which is the
entry most worth having.

### And a successful body never reaches it

A response that succeeded may carry a **freshly minted API key**
(decision 0006) or a credential. Decision 0009 is this project's own
record of key material reaching somewhere nobody expected, and **a log
is exactly such a place**.

Only refusals carry detail, and only their `error` and `reason` — the
two fields a refusal uses (decision 0132) — rather than a body whose
shape nobody has audited. Watched to fail: logging the whole body
breaks the test that looks for a secret in the row.

### Logging never blocks

`recordAdminAction` cannot throw. **An operator refused because an audit
insert failed would be a control that denies service** — and acting
without a record is the risk this accepts deliberately rather than by
omission.

---

## Approval stays separate from provisioning

Decision 0038's whole point: **approval creates nothing**, and a test
proves it by approving a request and confirming `customers` is still
empty.

A button labelled *Approve* that quietly provisions would undo that.
Two explicit actions on the screen, as they are two explicit acts today.

The operator's reason for the checkpoint, restated because a UI makes it
one click: *"else I might have people requesting an environment to check
out the software, such as a competitor."* **One click is fine; one click
that does two things is not.**

---

## What the screen shows

- **Pending requests**, with the company, the contact, their notes and
  the region asked for (decision 0137) — enough to decide with.
- **Approve** and **reject**, each recording the verified identity.
- **Provision**, separately, and only for an approved request.
- **Every customer and environment**, with whether infrastructure exists
  — `infrastructureProvisioned` and the `not-yet-deployed.invalid`
  placeholder are already honest about this (decision 0039).

---

## Deliberately not decided here

- **Whether a second operator ever exists.** Access supports it and the
  attribution work makes it meaningful, but nothing else does —
  `ADMIN_API_KEY` remains one shared secret between `vf-admin` and
  `vf-licence`.
- **Log retention.** Decision 0090 chose twelve months for sign-in
  attempts under A.12.4.1, and privileged actions are arguably longer.
- **Whether `vf-admin` should read the control plane directly** rather
  than through `vf-licence`. It cannot: `CONTROL_DB` is bound to
  `vf-licence`, and a second binding would be a second thing that can
  write to it.
- **Alerting.** A request arriving still tells nobody (decision 0125),
  and a screen only helps somebody who thinks to look.
