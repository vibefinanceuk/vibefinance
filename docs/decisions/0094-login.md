# 0094 — Signing in

**Status: built.** `POST /login`, `POST /my-environments`, and the
admin-key provisioning surface that makes a first account possible.

---

## The bootstrap account turned out to be unnecessary

Decision 0083 section 7 designed a per-environment administrator that
self-disables once a named administrator exists — to break the deadlock
decision 0055 section 8.2 records, where creating the first user is
structurally impossible.

**It is not needed.** The operator already holds the admin key, and
`setCredential` and `grantAccess` are control-plane operations. So the
first credential is created at provisioning, by the person provisioning:

1. operator creates the environment,
2. operator creates a credential and a grant (this decision),
3. somebody creates the `org_users` row — the org endpoints are ungated
   precisely for this,
4. the person signs in.

A special account able to do exactly one thing would have been a fourth
mechanism to secure, disable and explain, replacing something that
already works. **Deferred rather than built**, and it can return if a
customer ever needs to bootstrap themselves without the operator.

---

## One refusal for every failure

No such account, wrong password, no grant for that environment, no such
environment — **all the same message and the same status.**

Distinguishing them would let anybody with an email address enumerate
who has an account and which environments exist. The person who
genuinely mistyped is told the same thing either way, which is a small
cost against a real one.

Watched to fail: replacing it with helpful messages breaks seven tests.

**The delay is the exception**, and deliberately so. Telling somebody to
wait is not a leak — they already know the attempt failed.

---

## The delay comes before any work

Checked first, before the environment lookup and before any password
verification.

**An attacker who has earned a wait should not also get a free
verification out of each attempt.** That CPU cost is the entire point of
Argon2id at OWASP parameters (decision 0089); handing it out to somebody
already being throttled inverts the defence into a denial of service
against the server.

A test asserts the **right** password is refused while the wait stands.

---

## An environment that does not exist still costs a verification

The absence would otherwise be detectable by timing — a fast refusal
means "no such environment", a slow one means "wrong password".

So a missing environment still runs `checkCredential` against a customer
id that cannot match, which itself hashes against a dummy (decision
0092). Every path through this endpoint spends the same time.

---

## What it returns

A session token scoped to the named environment (decision 0086), the
instance URL to go to next, and the report ISO 27001:2022 Annex A 8.5
asks for: **when this person last signed in, and every failed attempt
since** (decision 0090).

That last part is the reason attempts are kept after a success rather
than cleared. A person who does not recognise an attempt knows something
an audit log read by nobody never tells them.

---

## `POST /my-environments` requires the password

The selector needs to know which instances somebody may reach before
they choose one — decision 0083 section 5's *"lists what you can reach,
not what the customer owns"*.

**Answering that unauthenticated would turn an email address into a map
of a customer's estate.** So it takes the password, records an attempt
like any other, and refuses with the same message.

Attempts for it are recorded against environment `*`, since none has
been chosen yet. That keeps the delay applying to somebody probing the
list rather than a specific instance.

---

## What is not built

- **Nothing creates the `org_users` row.** Step 3 above is manual, and a
  person can hold a credential and a grant while the instance refuses
  them (decision 0088). The refusal should eventually say *what* is
  missing rather than implying the credential was wrong.
- **No alerting**, still. *"A lockout policy that generates no alert is
  half a control"* — and nothing here sends email.
- **The name in the token is the email**, because nothing in the control
  plane knows a display name. The instance's own record wins anyway
  (decision 0088), so this only shows if somebody reads the token
  directly.
