# 0092 — One password, and a row per instance you may reach

**Status: built** — the tables, credential checking, grants and
revocation. **Not built:** the login endpoint that calls them.

---

## The division, in the operator's words

> **`vf-licence` decides if you get access; `org_users` decides what you
> get access to.**

The same authentication-versus-authorisation line decision 0083 drew,
now with a mechanism behind the first half rather than an assertion.

Nothing in this module knows about roles, units or authority limits. It
answers one question — *may this person obtain a session token for this
environment* — and leaves everything after that to the instance.

---

## Two tables, because they answer different questions

**`user_credentials`** — keyed by email and **customer**. One password
across a customer's EU and US instances: a person should not hold two
secrets for what is, to them, one organisation.

**`user_environment_access`** — keyed by email and **environment**.
Which instances that person may reach.

### This is the mechanism decision 0083 section 5 needed

That decision said the environment selector *"lists what you can reach,
not what the customer owns"*, and left it as an authorisation question
with nothing behind it.

These rows are the answer, and the selector can be built from **one
control-plane query** rather than calling every instance in turn.

---

## The invariant that matters most

```sql
-- a grant names an environment belonging to the customer whose
-- credential the person holds
```

**One row, and the isolation the whole design rests on is gone.** A
grant pointing at another customer's environment would hand somebody a
session token for data that is not theirs, and every other control —
the audience claim, the per-instance database, the whole two-Worker
split — would work perfectly while it happened.

Enforced twice on purpose: a standing invariant, so it cannot be written
by any route or by hand, and an explicit check in `grantAccess` so the
caller gets a reason rather than a constraint error.

Watched to fail.

---

## Verification takes the same time whether or not an account exists

Returning early when no credential is found would make a missing account
**measurably faster** than a wrong password — which turns the login
endpoint into a way to enumerate who has an account.

So a real Argon2id verification runs against a fixed dummy hash and the
result is discarded. Watched to fail: removing it breaks the timing
test.

---

## Length over complexity

A minimum of twelve characters and no complexity rules, following NIST:
a long passphrase beats a short string with a symbol in it, and
complexity requirements mostly produce predictable substitutions and
passwords written on notes.

---

## Revoking removes the way in, and nothing else

`revokeAccess` deletes the grant and **leaves `org_users` alone**.

What somebody may do in an instance is that instance's record, and an
administrator there may want the row kept for the history attached to
it — who approved what, who keyed which field. Deleting it from the
control plane would reach across the boundary this decision exists to
draw.

Revoking one environment also leaves the credential and any other grants
intact: one instance revoked is not all of them.

---

## What is not built

- **The login endpoint.** Every piece now exists — credential checking,
  progressive delay (0090), session tokens (0086), the ISO 8.5 report —
  and nothing assembles them.
- **The bootstrap administrator**, so there is somebody to sign in as.
- **No route creates a credential.** `setCredential` and `grantAccess`
  exist as functions; provisioning has to call them.
- **Nothing reconciles a grant with the instance.** An access row
  without a matching `org_users` row means the selector offers an
  instance that then refuses on arrival (decision 0088). That is
  coherent under this division — access granted, capabilities not yet
  assigned — but it is a state somebody will meet, and the refusal
  should say what is missing rather than implying the credential was
  wrong.
