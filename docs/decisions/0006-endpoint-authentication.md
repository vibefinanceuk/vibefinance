# 0006 — vf-licence endpoint authentication: two mechanisms, not one

Status: settled, 30 August 2026. Closes the gap flagged explicitly in
docs/decisions/0004-usage-telemetry.md: none of `POST /customers`,
`POST /licences`, or `POST /usage` had any authentication, and usage
data specifically has a direct billing implication.

## Two different problems, deliberately two different mechanisms

**Admin auth** (`POST /customers`, `POST /licences`,
`POST /customers/:id/rotate-key`) protects provisioning — who can
create a customer or change what they're entitled to. A single shared
secret (`ADMIN_API_KEY`) is the right fit: there's one operator.

**Per-customer auth** (`GET /licences/:id/token`, `POST /usage`)
protects the machine-to-machine calls each customer's own `vf-app`
instance makes. A shared secret would be the wrong tool here — the
property that actually matters is that customer A's credentials must
never authenticate as customer B, which a single admin key cannot
express at all (everyone with it could act as anyone). Each customer
gets a random key of their own, generated at creation, checked against
that specific customer's stored hash on every request.

Conflating these into one mechanism was considered and rejected: a
single admin key protecting everything would mean every customer's
`vf-app` instance holds the same credential that can create and
reconfigure *other* customers — a much bigger blast radius than any
individual instance needs, and inconsistent with the trust boundary
this whole system already goes to some trouble to maintain (see
decision 0001).

## Generate-once, hash-only-stored — the standard pattern

Same convention as GitHub, Stripe, and most real API-key systems:
`POST /customers` generates a random 256-bit key, returns the
plaintext exactly once in the response body, and stores only its
SHA-256 hash. There is no "show me the current key" endpoint, by
design — the plaintext is never persisted anywhere to show. Losing a
key means rotating it (`POST /customers/:id/rotate-key`), never
recovering it.

## Constant-time comparison, and its honest limit

`shared`-style discipline extended to `vf-licence`'s own `auth.ts`:
key comparison uses a constant-time byte-XOR loop, not `a === b`,
which short-circuits on the first differing byte and can leak how many
leading characters matched via response timing — the same convention
Node's own `crypto.timingSafeEqual` follows.

Worth being honest about what the tests here can and can't prove: they
confirm `timingSafeEqual`'s *return value* is correct for every case
tried (equal, unequal, different lengths, empty strings) — they cannot
and do not confirm the actual constant-time *property*, which is only
observable via real timing measurement, not a return-value assertion.
Confirmed directly: swapping in a naive `a === b` implementation passes
every one of those tests identically. The loop-structure correctness
(no early return based on where a mismatch occurs) has to be verified
by reading the implementation, not proven by a test — recorded here so
that limit isn't silently assumed away by a green test suite.

## The Acme backfill

Acme was created before any of this existed, so its `api_key_hash` is
`NULL` after the migration — and `isValidCustomerKey` correctly treats
a `NULL` hash as "cannot authenticate," not as open access. Getting
Acme working again needs one live step, once: an admin-authenticated
call to `POST /customers/Acme/rotate-key`, which is the same operation
as issuing a first key — "rotating" a key that never existed is not a
different code path.

## Operational sequencing this bundle needs, done in order

This is the one bundle in this whole project where deploy order
actually matters and getting it backwards would briefly lock out the
already-live `Acme` usage push:

1. Generate and set `ADMIN_API_KEY` on `vf-licence`
   (`scripts/generate-admin-key.mjs`, piped directly into
   `wrangler secret put` — never printed and re-typed).
2. Deploy `vf-licence` with the new code and migration.
3. Call `POST /customers/Acme/rotate-key` (admin-authenticated) to get
   Acme's first real key.
4. Set that key as `VF_LICENCE_API_KEY` on `vf-app`.
5. Deploy `vf-app`.

Deploying `vf-app` before step 3 would mean it has nothing to
authenticate with yet; deploying `vf-licence` before step 1 would mean
the admin routes 401 unconditionally (correct, if inconvenient,
fail-closed behaviour — not a bug).

## What's still open

- Neither `POST /customers` nor `POST /licences` nor the rotation
  route rate-limits failed attempts — a very online attacker could
  brute-force `ADMIN_API_KEY` given enough attempts, though the 256-bit
  key space makes this impractical today. Worth revisiting if this
  control plane ever handles enough customers that this becomes a
  realistic concern rather than a theoretical one.
- No key expiry — a customer's key is valid indefinitely until
  explicitly rotated. Reasonable for now; an expiry policy would be a
  natural, additive follow-up once there's a real operational reason
  to want one.
