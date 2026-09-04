# 0089 — Local accounts, and how a password is stored

**Status: hashing built** (`shared/auth/password.ts`). The login
endpoint, rate limiting, lockout and the bootstrap administrator are
not. Written before code because the first choice is security-critical
and has a hard platform constraint behind it.

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

## Decided

**Argon2id via `@noble/hashes`.** The operator's reasoning was the
practical form of the argument: *PBKDF2 seems like a security risk, most
IT teams would question it.* A customer's security team asks which
algorithm and which parameters, and *"PBKDF2 at 100,000, because our
platform will not do more"* invites the obvious follow-up. *"Argon2id at
OWASP's recommended parameters"* ends the conversation.

The package brings **zero transitive dependencies**, which is most of
why it is the least-bad shape for this exception.

**Superseded by decision 0091.** `password_hash` beside `api_key_hash`
on `org_users` was the intention, and it is not possible: `vf-licence`
has only `CONTROL_DB` and cannot read a customer's user table at all.
The credential lives in the control plane and `org_users` stays where it
is — one thing split by purpose, not two copies.

**The bootstrap administrator self-disables** once a named administrator
exists. Stronger than a permission, which somebody could grant onward:
the account stops being a way in rather than relying on nobody misusing
it. The care needed is that it cannot disable itself mid-setup and
strand the person doing it.

---

## Two properties that would fail silently

Both watched to fail, because neither shows up in ordinary use.

**A unique salt per password.** With a fixed salt everything still
round-trips — passwords hash, verification succeeds, tests pass. What
breaks is invisible: identical passwords produce identical hashes, a
precomputed table becomes useful, and a breach reveals who shares a
password with whom.

**Verification uses the parameters the hash was made with**, not
today's constants. Verifying under current parameters also works
perfectly — until the cost is raised, at which point **every existing
password stops verifying at once.** The failure arrives with the
upgrade, long after the code was written.

`needsRehash` is the other half: after a successful sign-in, a hash
below current strength can be re-derived from the password the person
has just proved they know. Without it, raising the cost only ever
protects new accounts.

---

## Still not built

- **The login endpoint**, in `vf-licence` beside the dev stub, minting
  the same session token (decision 0086).
- **Rate limiting.** No hash is strong enough against unlimited
  attempts, and this matters more than the algorithm choice.
- **Lockout**, and its denial-of-service trade-off.
- **Reset**, which needs email — and nothing here sends any.
- **The bootstrap administrator**, whose shape is settled above.

---

## The dependency belongs to `shared`, not the root

Found by a **failed deploy**, not by a test.

`npm install @noble/hashes` at the repository root put it in the root
`package.json`. This is an npm workspace, and `vf-licence` depends on
`@vibefinance/shared` — so wrangler's bundler could not resolve the
import and the deploy failed outright:

```
Could not resolve "@noble/hashes/argon2.js"
```

Moved to `shared/package.json`, beside `fast-xml-parser` — the only
other runtime dependency in this project — because `shared` is the
package that imports it.

### Two things worth noticing

**`vf-licence` does not use password hashing at all**, and still failed
to build. `shared/index.ts` re-exports everything, so importing anything
from `@vibefinance/shared` requires every dependency of the barrel to
resolve, whether the Worker uses it or not.

**The bundle did not grow.** Both Workers build to exactly the size they
did before — esbuild tree-shakes the unused code away. So the barrel
costs nothing at runtime and everything at build time: the dependency
must be **resolvable** even where none of it ships.

That asymmetry is easy to get wrong in the other direction too. A
dependency that resolves in tests and in `tsc` can still fail a deploy,
because those three read the module graph differently — **and only one
of them is the one that matters.**
