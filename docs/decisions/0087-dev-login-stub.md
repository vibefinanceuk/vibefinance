# 0087 — The development login stub

**Status: built.** `POST /dev-login`, off unless explicitly enabled, and
unable to reach production even when it is.

---

## Why a stub at all

Decision 0083 section 7 parked the choice between SAML and OIDC, because
almost nothing depends on it: everything downstream consumes a verified
identity via the session token and does not care how it was minted.
**Exactly one endpoint cares**, and this is the placeholder standing
where it will be.

Without it there is no way to sign in, and therefore no way to build or
test a screen.

---

## Two guards, and neither is sufficient alone

**`ALLOW_DEV_LOGIN` must be set.** Absent, the route does not exist.
Enabling is a deliberate act rather than a default somebody forgot to
change.

**And the environment must not be `production`.** Even with dev login
switched on — left on by accident, enabled for a debugging session and
never turned off — this route cannot mint a production token.

The first can be forgotten. The second cannot. That asymmetry is the
whole reason for having both: *"temporary authentication bypass in the
control plane"* is precisely the kind of thing that outlives its intent,
so it refuses rather than relying on anybody remembering to remove it.

Watched to fail independently: disabling either guard breaks two tests,
and a different two each time.

---

## 404, not 403

A deployment without dev login should not admit that such a route could
exist. A 403 tells somebody probing that there is something here to
enable; a 404 tells them nothing.

---

## The cost, accepted deliberately

`Acme-production-eu` is the only environment with real data — every
invoice tested in this project lives there. The production guard means
**screens cannot be built against it.**

That is a real cost and the right one. Developing a UI against a
customer's live invoices is its own bad habit, and this forces a sandbox
to exist instead. The work it creates — provisioning and seeding one —
is work worth doing regardless.

---

## Not an admin route

Deliberately. **Signing in is the one thing a person does before holding
any credential**, so requiring one would be circular.

Its protection is the two guards, not a key. That is a smaller surface
than it sounds: with the flag unset it is a 404, and with it set the
worst outcome is somebody obtaining a sandbox session.

---

## What it produces

A session token naming the environment it is for (decision 0086), so an
instance refuses one addressed elsewhere. A test carries this end to end
from minting: a token issued for `acme-sandbox-eu` is **refused by**
`acme-production-eu` — which is what stops a sandbox session reaching
production even though a single signing key serves the whole fleet.

The response says `"issued by the development login stub — this is not
single sign-on"` in the payload, not merely in a comment. Anybody
holding one of these should know what it is without reading the source
that minted it.

---

## What replaces it

An SSO endpoint at the same place, producing the same token. Everything
downstream — instance verification, the environment selector, every
screen — depends on the token and not on this route, which is the seam
decision 0083 section 7 drew deliberately.

**Removing this route should be a deletion, not a refactor.** If it ever
is not, the seam has been blurred.
