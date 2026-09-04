# 0086 — Session tokens

**Status: built** — the token itself. **Not yet built:** the endpoint
that mints one, and instance-side verification. Step two of decision
0083's build order.

---

## The same crypto, deliberately different claims

JWT-shaped, ECDSA P-256, exactly as `shared/licensing/token.ts`. That
scheme is proven: its forgery and tampering resistance is tested
directly, and Web Crypto behaves identically in workerd and production,
so nothing here needed a test double (decision 0011).

**What differs is what the token says and how long it lives.** A licence
token says *this customer is entitled to X* and lives 48 hours; a
session token says *this person is authenticated* and lives an hour.
Sharing the crypto while separating the claims is the point — one token
carrying both would have a lifetime suiting neither (decision 0083
section 2).

---

## The finding: one signing key serves the whole fleet

**This shaped the design and was not obvious before looking.**

`vf-licence` holds a single signing key. Every instance verifies with
the same public half — that is what makes local verification with no
network call possible, and it is why the licence design works.

It also means a session token asserting only *"this person
authenticated"* would be **valid at every customer's instance**. A
session for Acme would open Northwind's data, with a perfectly good
signature, and nothing in the token would be wrong.

So the token names the environment it is for, and
`verifySessionToken` requires the caller to say which environment it
expects:

```ts
verifySessionToken(token, publicKey, expectedEnvironmentId)
```

**Required, not optional.** An optional audience check is one that
eventually goes unpassed — and the failure mode is silent and total.

Watched to fail: removing the check breaks two tests, including one
asserting that a token for the same customer's *other region* is
refused. Regions are separate instances holding separate data; EU is not
US even for one customer (decision 0084).

---

## The signature is checked before anything else it asserts

Order matters. Reporting *"wrong environment"* or *"expired"* for a
token that was never validly signed tells an attacker their forgery was
structurally correct and merely mis-addressed.

A test confirms it: a token whose `environmentId` was swapped after
signing is refused for its **signature**, not its audience — even when
verified against the environment the forger inserted.

Same ordering as decision 0073's document URLs, and for the same reason.

---

## No revocation, and an hour is the mitigation

A token is valid until it expires and nothing can call it back.

That is a reasonable trade at an hour and would not be at a day. It is
stated here rather than discovered: **the TTL is the only bound on a
leaked session**, which is the whole argument for keeping it short.

---

## What is not built

- **The endpoint that mints one.** Per decision 0083 section 7 the
  identity provider is parked, so the first implementation is a
  conspicuously dev-only stub that must refuse to run against
  production.
- **Instance-side verification.** `vf-app` verifies licence tokens
  already; session tokens need the same treatment plus the mapping from
  `email` to an `org_users` row.
- **What happens to the per-user API keys.** Every live test in this
  project authenticates with one. A session token does not obviously
  replace a service credential, and this decision does not pretend
  otherwise.
