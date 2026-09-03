# 0073 — A pop-out window cannot send a header

**Status: built.** The last piece the keying screen needs before it can
show anybody a document.

---

## The problem

Keying is reading a document and typing what it says. That works best
with the document in one window and the form in another — split across a
screen, both visible.

`window.open` sends no `Authorization` header. A route protected the way
every other route here is protected returns **401 in the new window**.

---

## Three options, and why this one

`docs/design/operator-interface.md` section 4 costed them:

| Approach | Survives refresh | Second auth mechanism |
| --- | --- | --- |
| Blob URL from the parent | **No** | No |
| Cookie-authenticated route | Yes | **Yes** |
| Short-lived signed URL | Yes | No |

A window left open across a split screen for several minutes cannot
afford to die on refresh, which rules out the blob. A cookie would
introduce a second authentication mechanism alongside the bearer token —
the kind of divergence that causes trouble later, and this codebase
already has three credential types to keep straight.

So: **a token that carries its own authority**, scoped to one document
and expiring in five minutes.

---

## HMAC, not the ECDSA the licence tokens use

Decision 0011 chose a public-key scheme for a specific reason: a licence
token is verified by a **different Worker** that must never be able to
mint one, so the asymmetry is the whole point.

That does not apply here. A document token is minted and verified by the
same deployment, so a shared secret is the honest fit and the simpler
one. Choosing ECDSA for consistency would be cargo-culting the shape of
an earlier decision without its reason.

---

## The secret refuses rather than degrades

`DOCUMENT_URL_SECRET`, set with `wrangler secret put` — never a var.
Decision 0012 records exactly what happens when signing material goes
into a committed config file, and that incident cost a keypair
rotation.

Its absence returns 500. Minting an unsigned URL, or falling back to a
built-in default, would hand out an unauthenticated link to a customer's
invoice — a far worse failure than refusing.

---

## Two details that are security properties, not polish

**The signature is checked before the expiry.** Reporting `expired` for
a token that was never validly signed would tell an attacker their
forgery was structurally correct and merely mistimed. A test asserts the
order.

**The comparison is timing-safe.** A plain `===` leaks, through response
timing, how many leading bytes a guess got right — the same reasoning
decision 0006 applies to API key comparison.

---

## Tested against real forgery

Web Crypto works identically in workerd and production, so nothing here
needed a test double — the same finding decision 0011 recorded for
licence tokens.

The suite proves the attacks the signature exists to prevent, not just
the happy path: a token signed with a different secret, a token whose
**invoice id was swapped** after signing (a valid link for a document you
may see, edited to name one you may not), and a token whose **expiry was
extended** after signing.

---

## The fetch route is deliberately unauthenticated

That is the point. The token *is* the credential: short-lived, scoped to
one document, unforgeable.

Two response headers matter. `Content-Disposition: inline` so a browser
displays the document rather than downloading it — the pop-out exists to
be read. And `Cache-Control: private, no-store`, because a signed URL is
a credential and caching it in a shared proxy would outlive the expiry it
depends on.

---

## What this does not solve

- **A PDF in a pop-out relies on the browser's own viewer**, which
  differs across browsers and cannot be controlled. An image is simple.
  A PDF may want a page-rasterisation step that cannot exist inside a
  Worker (decision 0042).
- **The URL still carries a credential in a query path**, where it can
  reach logs and referrer headers. Five minutes is the mitigation, not a
  cure.
- **No revocation.** A minted token is valid until it expires; there is
  nothing to revoke it early. For five minutes that is a reasonable
  trade, and it would not be for five hours.
