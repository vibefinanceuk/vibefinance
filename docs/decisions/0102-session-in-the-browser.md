# 0102 — Where a session lives in a browser

**Status: built.** `vf-ui` is now a backend-for-frontend: the token
lives in an `HttpOnly` cookie and never enters JavaScript.

---

## The question

The session token is held in a JavaScript variable, so **a refresh signs
you out.** The token is still valid — `vf-licence` signed it for an hour
and `vf-app` would accept it. The browser has simply forgotten it.

Tolerable on a login screen, where there is nothing to lose. Painful the
moment somebody is halfway through keying an invoice, and refreshes are
not deliberate acts: a page seems stuck, a laptop sleeps, a browser
updates.

---

## What current guidance actually says

**RFC 10017, *OAuth 2.0 for Browser-Based Applications*,** published
2026. Checked rather than recalled, because this area has moved.

> There is no browser API that allows to store tokens in a completely
> secure way.

That rules out both options previously being weighed. `localStorage` and
`sessionStorage` are **equally readable by any injected script**; the
only difference between them is how long they last. Choosing between
them is choosing how long a stolen token stays useful, not whether it
can be stolen.

The RFC's stronger point: an attacker running script in the
application's origin can **request new tokens** regardless of how well
the existing ones are hidden. Storage hardening addresses the symptom.

### Three patterns, and the one it recommends

| Pattern | Where tokens live |
| --- | --- |
| **Backend-for-Frontend** | The backend, in a cookie-based session. Never in the browser. |
| Token-Mediating Backend | The backend obtains them; the frontend holds them **in memory only** |
| Browser-based client | Entirely in the browser — not recommended |

**A caveat on applying it.** RFC 10017 is about OAuth: authorisation
servers, refresh tokens, PKCE, redirect URIs. We have none of that —
`vf-licence` verifies a password and signs a token. The token-storage
finding generalises; the OAuth machinery does not, and adopting the
pattern is not adopting the protocol.

---

## The recommendation: BFF, with the token in the cookie

**`vf-ui` is already a Worker** — a real backend, not a static host. So
this is available rather than hypothetical.

1. The browser posts credentials to `vf-ui` (same origin).
2. `vf-ui` calls `vf-licence` and receives the session token.
3. `vf-ui` returns it as an **`HttpOnly` cookie**, which JavaScript
   cannot read.
4. The browser calls `vf-ui` for data. `vf-ui` reads the cookie,
   attaches the token as `Authorization`, and forwards to `vf-app`.

**The token in the cookie itself**, rather than a session id pointing at
stored state. A Worker is stateless; holding sessions would mean KV, D1
or Durable Objects — new infrastructure for this one purpose. The token
is already a signed, self-contained, hour-lived credential. Putting it
somewhere the browser keeps and JavaScript cannot read is exactly what
is wanted, and needs nothing new.

---

## What this costs

**`vf-ui` becomes a request path.** Today it serves three files. Under
this it carries every data call: browser → `vf-ui` → `vf-app`. More
latency, and it becomes critical rather than convenient — a `vf-ui`
outage would stop work rather than stop new sign-ins.

Both hops are on Cloudflare's network, so the latency should be small.
**Should** is doing work in that sentence and it is worth measuring
rather than assuming.

**CSRF becomes a surface it was not.** Cookies are sent automatically,
so a cross-site request could act as the signed-in person — which a
bearer token in a header cannot be made to do. `SameSite=Strict`
addresses it, and is the reason to prefer strict over lax here.

**A second thing to keep straight.** `vf-app` would then accept both a
session token forwarded by `vf-ui` and an API key from a script, which
is already true (0095) but becomes load-bearing.

---

## What it buys beyond surviving a refresh

**CORS becomes unnecessary.** The browser only ever talks to `vf-ui`,
same origin. Decision 0098's allow-lists would become configuration
nobody needs — worth keeping the code, since the situation could return,
but the operational surface disappears.

**And an injected script cannot exfiltrate the token**, because it never
exists in a place script can read. It could still *make requests* as the
person — the RFC is clear that nothing prevents that — but the
credential cannot be taken away and used elsewhere, which is the
difference between an incident bounded by a session and one that is not.

---

## Built, and what it turned out to involve

**The proxy is an explicit allow-list**, not a general forwarder — a
decision made while building rather than in this design. A proxy that
forwards whatever it is given forwards routes nobody has thought about,
and this project found three write routes above an admin gate (0097) by
exactly that inattention. Adding a path is a deliberate act, and a test
asserts `/api/credentials` and `/api/access` are refused outright.

**Two lists, not one.** `/my-environments` and `/branding/:id/tokens.css`
go to `vf-licence` **with no session attached**, because both are
reached before anybody is signed in — choosing an instance is what
creates a session, and a login screen needs a livery before there is
one. Attaching a token to a route that does not expect one is how a
credential ends up somewhere nobody meant it to go.

**A 401 from an instance clears the cookie.** Otherwise an expired token
leaves a browser that believes it is signed in and an API that
disagrees, which presents as an unexplained failure on every action
rather than as being signed out.

**And `config.js` no longer carries an API address.** The browser talks
to one origin, so there is nothing to tell it. The mechanism stays,
because a UI needs to know things and removing it to add it back would
be churn.

---

## The property this exists for had no test

Watched to fail, and **nothing caught it**: returning the token
alongside the cookie passed all 27 tests. The single most important
thing about this change was untested.

The sign-in path cannot be exercised here — it needs `vf-licence` to
answer — so the step that decides what the page sees was extracted into
`visibleToPage()` and tested directly. **A function that can be tested
is better than a property that cannot.**

The sixth instance in two days of a check that did not point where it
seemed to. This one was found by looking for it rather than by
accident, which is the small improvement.

---

## What needs deciding

1. **Is the added latency acceptable?** Worth measuring on the first
   data screen rather than deciding in the abstract.
2. **Does `vf-ui` proxy everything, or only what a browser needs?** A
   narrow proxy is a smaller surface and more to maintain; a general one
   is simpler and forwards routes nobody has thought about.
3. **What happens when the token expires mid-session?** Today nothing
   refreshes it. An hour in, the cookie holds something `vf-app` will
   refuse, and the person is signed out mid-task with no explanation.
   **This exists today and is not created by this change** — but a BFF
   is where a silent renewal would sensibly live.
