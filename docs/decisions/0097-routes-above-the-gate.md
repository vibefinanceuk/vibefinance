# 0097 — Three write routes sat above the admin gate

**Status: fixed.** A live authentication bypass, found by the operator
testing a placeholder.

---

## What was wrong

`vf-licence` computes `isAdminRoute` partway through its fetch handler
and checks it immediately after. Everything above that point is
unauthenticated by construction.

**Three routes were added above it:**

| Route | What it could do |
| --- | --- |
| `POST /credentials` | Set a password for **any** email at **any** customer |
| `POST /access`, `DELETE /access` | Grant or revoke access to any environment |
| `PUT /branding/:id` | Rebrand any customer |

Each had an entry in the `isAdminRoute` expression. **Those entries were
dead code** — the handler returned before the expression was evaluated.

The first two together are a complete authentication bypass: create a
credential for an email that has an `org_users` row, grant it access,
sign in, receive a valid session token. No credential needed at any
point.

---

## How it happened

Each route was added **next to a related handler** rather than next to
the routes sharing its protection. `PUT /branding/:id` went beside the
`GET` that serves the stylesheet, which is deliberately public.
`/credentials` and `/access` went beside the login routes, which are
deliberately public for the same reason: signing in is what a person
does before holding any credential.

**Proximity by topic, where the file is organised by protection.** The
`isAdminRoute` entries were written in good faith and looked like they
did something.

---

## How it was found

The operator ran a command with `YOUR_ADMIN_KEY` left in literally, and
it worked. Then `Bearer sadfgsfsfg`, and that worked too.

**No test caught it.** Every route had tests, and they called the
handler directly — which is the right level for testing what a handler
does and says nothing about whether the router protects it. Three
separate test files, all passing, all testing the wrong layer for this
question.

---

## The fix, and the check that would have caught it

The three routes moved below the gate, beside `POST /customers` and the
others that were always protected.

And a table-driven test through `SELF.fetch` — **the real router, no
credential** — asserting every write route is refused, with and without
a wrong key. It asserts only the refusal, so it holds whatever
`ADMIN_API_KEY` is set to, which in tests is nothing.

Watched to fail: restoring the routes above the gate breaks eight of
them.

> **Adding a route to `isAdminRoute` is not what protects it.** Its
> position in the file is. The expression is a list of names; the
> `if` beneath it is the gate, and anything returning earlier never
> reaches either.

---

## What this says about the pattern

This is the third time this session that something looked protected and
was not, and the third time the protection and the *check that it
applies* turned out to be different things:

- a standing invariant that detects rather than prevents (0093),
- a test asserting existing rows survived while new ones would fail
  (0084),
- and now a route list that names routes it does not reach.

**In each case the mechanism was real and pointed at the wrong place.**
The general form is worth naming: *a guard is only a guard where it
runs*, and the way to know is to exercise the real path rather than the
piece you believe is on it.
