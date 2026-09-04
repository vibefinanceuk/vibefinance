# 0088 — An instance accepts a session token

**Status: built.** `authenticateSession` in `workers/vf-app/src/user-auth.ts`.
Not yet used by any route — that is deliberate, and the next piece.

---

## Four things must hold

1. the signature verifies,
2. the token names **this** environment,
3. it has not expired,
4. an active `org_users` row exists for its email.

The first three are `verifySessionToken`'s job (decision 0086). The
second is the one carrying the security weight: a single signing key
serves the whole fleet, so without it a session for one customer would
be accepted by every instance.

**The fourth is this function's own contribution.**

---

## A person with no row is refused, not created

The decision, and the operator's own reasoning: *someone with no
`org_users` row is not set up, and we know nothing about them — no name,
no title, no role.*

A row created on first login would have **no roles, no unit, no
authority limit**. It would appear in listings, be selectable as a task
assignee, and count as a user — the *shape* of an account without any of
the decisions that make one meaningful.

It also fits what is already built. `assign_task` names a team or a
user, `org_authority_limits` binds to a user, permissions come from
roles. Every one assumes somebody deliberately set the person up, and a
row that materialised on login satisfies none of them while looking as
though it should.

And it keeps the instance in control of who exists. A customer whose
directory holds ten thousand people does not want ten thousand potential
rows in their accounts payable system — which is the practical
difference between the identity provider deciding and the instance
deciding.

Watched to fail: provisioning on first login instead breaks four tests.

---

## `unknown_user` is not `invalid_token`

Distinguished deliberately, because they send a person to different
places.

A valid, correctly-signed token for somebody with no row is **not a
credential problem**. The token is fine; the person is not set up.
Reporting it as a failed sign-in sends them to reset a password that was
never wrong, when what they need is an administrator.

Four outcomes, each nameable: `no_token`, `invalid_token`,
`unknown_user`, `not_configured`.

---

## The instance's record wins over the token's claims

The token says *who authenticated*. The database says *who they are
here* — including a name an administrator may have corrected after the
identity provider supplied it.

So the returned user is built from the row, not the claims. A test
asserts a token carrying `"D. Young (from IdP)"` still yields the
`Dan Y.` the instance holds.

---

## Not configured refuses rather than degrades

Without `ENVIRONMENT_ID`, verifying would mean accepting a token minted
for **any** environment. That is the one failure this design cannot
tolerate, so a missing configuration is a refusal rather than a relaxed
check.

---

## The consequence: the bootstrap account becomes load-bearing

Nobody can sign in to a fresh environment until somebody exists. That is
exactly the deadlock decision 0055 section 8.2 records, and why the org
endpoints are ungated today.

Decision 0083 section 7 has the shape that breaks it: a per-environment
administrator created at provisioning, able to do one thing — create a
named administrator — after which every action is attributable to a
person.

**Refusing unknown users makes that account necessary rather than
merely tidy.**

---

## What is not built

- **No route uses this yet.** Every endpoint still authenticates by API
  key. Session and key authentication will coexist, and which routes
  accept which is a separate decision — a service credential and a
  person's session are not the same thing (decision 0086).
- **Nothing maps a session to permissions.** `hasPermission` takes a
  user id, so it works unchanged once a session yields one; that path
  has not been exercised.
