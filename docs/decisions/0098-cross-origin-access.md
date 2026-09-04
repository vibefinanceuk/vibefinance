# 0098 — Which web pages may read a response

**Status: built**, and **inactive until configured.** `ALLOWED_ORIGINS`
is unset on both Workers, so their behaviour is unchanged.

---

## What CORS actually is

**Entirely a browser mechanism.** A server blocks nothing; it states
which origins are permitted, and the browser withholds the response from
JavaScript when the headers do not allow it. `curl` ignores all of it,
which is why every command in this project works today with no CORS
headers anywhere.

So this is not a control against a determined caller — it decides
**which web pages may read a signed-in person's data**, which is
narrower and still worth getting right.

---

## An explicit list, never a wildcard

`ALLOWED_ORIGINS` names the permitted origins, comma-separated. The
matching one is echoed; anything else gets no header, and **the absent
header is the refusal** — that is what a browser reads.

**Echoing whatever arrived is a wildcard with extra steps**, and the
well-known mistake that makes an allow-list decorative. A test asserts
`https://app.vibefinance.com.evil.com` is refused, since a naive prefix
check would let it through.

Development adds `http://localhost:8788` in the dev configuration only —
**a difference in configuration rather than code**, so a production
Worker never carries a rule that exists only for development.

---

## No `Access-Control-Allow-Credentials`, deliberately

Checked rather than assumed: "credentials" in the CORS sense means
**cookies and TLS client certificates**. These APIs authenticate with a
bearer token, which is an ordinary header.

So the header is not needed — and omitting it means a browser will not
attach cookies to these requests **even if the origin check were
wrong**. A smaller blast radius for free.

It also rules out the combination the specification forbids outright: a
wildcard origin with credentials, which would expose every
authenticated response to every site.

---

## `Authorization` must be named

Not CORS-safelisted, so any request carrying a session token triggers a
preflight — and **it cannot be wildcarded**, checked against MDN rather
than recalled. `Access-Control-Allow-Headers` names it explicitly.

This is the detail that would have produced a puzzling failure: the API
working from `curl`, the UI failing, and the browser console blaming a
missing origin header rather than the header it actually could not send.

---

## `Vary: Origin`

Sent whenever CORS is configured, allowed or not, because the response
genuinely differs by origin. A cache ignoring that could serve one
origin's permitted response to another.

---

## Applied at the edge, not per route

`handlePreflight` answers before routing; `withCors` wraps whatever the
router produced.

**No individual route has to remember.** A route that forgot would work
from `curl` and fail from a browser — precisely the shape of divergence
this project keeps finding, most recently three routes sitting above the
admin gate (decision 0097).

---

## Unset changes nothing

No configured origins means no headers, and `withCors` returns the
original response object untouched.

That matters more than it sounds: **every existing test and every `curl`
in this project is unaffected by this existing**, and a Worker with no UI
configured behaves byte-identically to before. Tested end to end through
the real router, where `ALLOWED_ORIGINS` genuinely is unset.

---

## One thing worth stating plainly

`vf-app` is deployed per customer, and its allow-list will name the
shared UI — **the same value for every customer**.

That makes explicit something already true architecturally: each
customer's instance trusts a UI the operator runs. CORS does not
introduce the trust, it writes it down.

---

## What is not built

- **Nothing is configured.** Both Workers have `ALLOWED_ORIGINS` unset
  until `vf-ui` exists and has an origin.
- **No `Access-Control-Expose-Headers`.** A UI reading a custom response
  header would need it; none does.
