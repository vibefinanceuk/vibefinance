# 0089 — Local accounts, and how a password is stored

**Status: proposed.** Nothing built. Written before code because the
first choice is security-critical and has a hard platform constraint
behind it.

---

## Why local accounts exist at all

Decision 0083 section 7 records the correction: **SSO is one path, not
the path.** Some customers will not integrate an identity provider and
some do not have one.

Decision 0088 then made a local account structurally necessary rather
than merely convenient: an instance refuses a session for anybody with
no `org_users` row, so **nobody can sign in to a fresh environment until
somebody exists.** That is the deadlock decision 0055 section 8.2
records, and a local bootstrap administrator is what breaks it.

So local accounts are three things at once: the path for customers
without an IdP, the bootstrap for every environment, and the only way to
sign in to production at all — since the development stub deliberately
cannot (decision 0087).

---

## The constraint: Workers cap PBKDF2 at 100,000 iterations

**Checked, not assumed.** Requesting more throws:

```
NotSupportedError: Pbkdf2 failed: iteration counts above 100000
are not supported (requested 600000)
```

OWASP's Password Storage Cheat Sheet puts the minimum for
PBKDF2-HMAC-SHA256 at **600,000** iterations. So the obvious approach —
native Web Crypto, which this project already uses for everything —
**cannot meet current guidance.** It falls six-fold short of the
weakest of the four sanctioned algorithms.

That matters more than it would elsewhere. `hashApiKey` uses plain
SHA-256, which is correct for a 32-byte random key because brute force
is infeasible regardless. **A human-chosen password has none of that
entropy**, and the whole defence is making each guess expensive.

---

## Argon2id, and it is measured rather than assumed

OWASP's primary recommendation, and a pure-JavaScript implementation
runs at its baseline parameters inside the CPU budget:

| Parameters | Time |
| --- | --- |
| `t=2, m=19,456 KiB, p=1` (OWASP baseline) | **321 ms** |
| `t=1, m=47,104 KiB, p=1` (higher-memory option) | 689 ms |

Measured directly with `@noble/hashes` before proposing it. 321 ms of
CPU per sign-in is real and acceptable: logins are rare compared with
every other request, and the alternative is a hash six times weaker than
the weakest thing OWASP will sanction.

**Memory-hardness is the point.** PBKDF2 is CPU-bound, and GPUs and
ASICs compute it orders of magnitude faster than a defender's server.
Argon2's memory cost is what makes that hardware advantage expensive.

> **A dependency decision, stated as one.** This project has almost no
> runtime dependencies. Adding one for password hashing is a deliberate
> exception — and the alternative is writing a memory-hard KDF by hand,
> which would be far worse. `@noble/hashes` is audited, dependency-free
> and widely used, which is the least-bad shape for this exception.

---

## What a password path needs beyond hashing

Naming these now, because "add password login" sounds like one task and
is not:

- **A unique salt per password**, stored with the hash. Argon2's
  encoded form carries salt and parameters together, which is what
  allows the cost to be raised later without invalidating existing
  hashes.
- **Rate limiting.** No hash is strong enough if an attacker gets
  unlimited attempts. This is the measure that matters most and it is
  not a hashing decision.
- **Lockout**, and its own trade-off: too aggressive and it is a
  denial-of-service against real users.
- **Reset**, which needs email — and **nothing in this system sends
  email at all** (`docs/PROGRESS.md`). An administrator setting a
  password directly is the only reset available today.
- **Policy questions that become customer-facing:** length, complexity,
  rotation, MFA. *"We support SSO"* was the answer that deferred all of
  these to somebody else's identity provider.

---

## The bootstrap administrator

Decision 0083 section 7 settled the shape and rejected the alternative.

**Rejected: a shipped default credential.** An `Administrator` account
with a known password would be identical across every deployment, sit in
git, and appear in any conversation discussing it. That is worse than
the ungated org endpoints it would replace — an unprotected endpoint at
least requires reaching it, where a default credential can be used from
anywhere.

**The shape:** a per-environment administrator created at provisioning,
with a password set then and handed over, reusing the show-once,
store-only-the-hash pattern already applied to admin keys and
environment keys.

**And it should do exactly one thing** — create a named administrator —
after which every action is attributable to a person rather than to a
shared login.

---

## What needs deciding before building

1. **Argon2id via `@noble/hashes`, or PBKDF2 at 100,000 with the
   shortfall documented?** The first adds a dependency and meets
   guidance; the second uses only what is already here and does not.
   For a financial product this looks like a one-sided trade, but it is
   a dependency in a codebase that has deliberately avoided them.
2. **Where the credential lives.** `org_users` has `api_key_hash`
   already; a `password_hash` beside it is the obvious place, and means
   a person may hold both a service key and a password.
3. **Whether the bootstrap administrator is created at provisioning or
   on first use**, and what "exactly one thing" is enforced as — a
   permission, a flag, or an account that disables itself once a named
   administrator exists.
