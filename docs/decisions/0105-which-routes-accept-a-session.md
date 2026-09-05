# 0105 — Which routes accept a session

**Status: fixed.** Claiming a task worked from `curl` and failed from
the screen.

---

## What was wrong

`POST /tasks/:id/claim` used `requirePermission`, which calls
`authenticateUser` — **API keys only**. A person clicking *Claim* in the
Task Manager got a 401; the same call with a bearer key succeeded.

The route predates sessions. When `authenticateUserOrSession` was added
(decision 0095) it went to `/whoami`, and later to `/tasks` and
`/tasks/:id/release` — and nobody revisited the routes written before
it.

---

## Why no test caught it

**`authenticateUserOrSession` was tested and worked.** What nothing
tested was *which routes call it*.

Every session test verified the function directly. The routing —
whether a given endpoint reaches that function or the older one — had no
coverage at all, and **927 tests passed while the button did nothing.**

That is the same shape this project keeps finding, now in its seventh
form: a real mechanism, working correctly, **not connected to the thing
being asked about.**

| | The mechanism | Where it actually pointed |
| --- | --- | --- |
| 0084 | A migration test | Existing rows, not new ones |
| 0093 | A standing invariant | Detection, not prevention |
| 0097 | `isAdminRoute` | Routes it never reached |
| 0100 | A lint rule | Output nobody read |
| 0101 | An asset test | A fallback page containing the string |
| 0103 | A counts test | A page that happened to hold the task |
| **0105** | **A session test** | **The function, not the routes** |

---

## What made it untestable, and the fix

The real signing key lives in `wrangler.jsonc` and its private half is a
secret. So a test could verify the function with a keypair of its own
and **could not reach the router**, which needs a token the deployed
public key will accept.

`wrangler.test.jsonc` — which already exists for exactly this kind of
divergence — now carries a **test keypair**. The private half sits in
the test file. It is public in the repository on purpose: it signs
nothing real, and production uses the key in `wrangler.jsonc`.

That buys a table-driven test asserting **every route a browser needs
accepts a session**, through `SELF.fetch` with a genuine token:

```
GET  /whoami
GET  /tasks
POST /tasks/:id/claim
POST /tasks/:id/release
```

It asserts only that the credential was *understood* — not 401. What
each route then does belongs to its own tests.

Watched to fail: restoring the original `requirePermission` breaks the
claim case and nothing else, which is precisely the bug.

And two cases keep the check honest: a session for **another
environment** is still refused, and so is **no credential at all** — a
route that accepted everything would pass the table above.

---

## The permission check survives

Replacing `requirePermission` could have dropped the authorisation with
the authentication. It does not: the task's own `required_permission` is
still checked, now against whichever credential authenticated.

**A task demands what it demands regardless of how somebody arrived.**

---

## What is still API-key only

Every route not in that table. `complete` is deliberately among them for
now — completing a Validation task from a list, without opening the
document, is not something anybody should do from a queue. That button
belongs on the viewer, and the proxy does not carry it either.
