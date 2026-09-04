# 0095 — The last hop: an instance accepts a session

**Status: built.** `GET /whoami` on `vf-app` — the first route that
accepts a session token, and the first thing a screen will ask.

---

## What this closes

Decision 0088 built `authenticateSession` and wired it to nothing.
Decision 0094 made a token obtainable. Between them a person could sign
in and had **nowhere to spend it**.

This is the hop that finishes the chain: `vf-licence` mints, `vf-app`
verifies, and a real user with real roles comes back.

---

## Sessions and API keys coexist

**Neither replaces the other**, and that is a decision rather than an
interim state.

A session is a person at a screen. An API key is a service credential —
and every live test in this project authenticates with one. Replacing
keys with sessions would break automation to solve a problem automation
does not have.

Session is tried first, because a browser presents one and a script does
not, so the common case for a UI comes before the fallback.

Watched to fail: removing the key path breaks two tests, including one
where the instance has no signing key configured at all.

### `unknown_user` does not fall through

A valid token for somebody with no `org_users` row **stops there**
rather than trying the key path.

The token was fine and the person is not set up here — a different
problem from a bad credential, needing a different answer from whoever
is helping them (decision 0088). Falling through would turn a clear
answer into "not authenticated".

---

## Every permission at once

`hasPermission` answers *"may they do X"*. A screen needs the whole set:
which buttons to render **at all**, rather than discovering by being
refused.

So `permissionsFor` merges across every role a person holds, and a role
with unparseable permissions grants nothing rather than failing the
request — **one bad row must not lock somebody out of every screen.**

---

## What it returns, and why each part

| Field | Why |
| --- | --- |
| `id`, `email`, `name` | From the instance's own record, not the token's claims (decision 0088) |
| `permissions` | So a screen renders correctly the first time |
| `authenticatedVia` | `session` or `api_key` — useful precisely when one works and the other does not |
| `environmentId` | So a UI can confirm it is talking to the instance it thinks it is |

That last one matters more than it looks: decision 0083 section 5 warns
that a queue labelled `Morrison-EU` while showing `Morrison-US` would be
a dangerous confusion rather than an untidy one. The instance saying its
own name lets a UI check.

---

## What is not built

- **Only this route accepts a session.** Every other endpoint still
  requires an API key. Which routes take which is a per-route decision
  and there was no reason to make thirty of them at once.
- **Nothing creates the `org_users` row.** A person can hold a
  credential and a grant and still be refused here, which is correct and
  is the manual step decision 0094 records.
