# 0003 — Licensing: signed token, fail-open, bootstrap-blocked

Status: settled, 29 August 2026. Implements Blueprint build order step 4
("The control plane: Customers, licences, the signed token, the offline
grace path, idempotent usage periods. Payments last.") — everything up
to "idempotent usage periods" and payments, which remain deferred.

## Token format: JWT-shaped, ES256

`shared/licensing/token.ts` produces a standard JWT shape
(header.payload.signature, base64url) using ECDSA P-256 + SHA-256
(ES256) rather than a bespoke format. Confirmed against Cloudflare's own
Web Crypto documentation before use (the exact `{ name: 'ECDSA', hash:
{ name: 'SHA-256' } }` shape their own example uses), and round-trip
tested with a throwaway key before writing the real implementation —
the same discipline as every other "which exact API call works here"
question this project has hit.

Using JWT's shape costs nothing and buys nothing operationally today,
but means any future tooling that understands JWTs (debuggers,
inspectors, `jwt.io`-style decoders) understands this for free, without
committing to any JWT *library* — the sign/verify logic is ~150 lines
of Web Crypto calls, not a dependency.

## Verification is a pure function; enforcement is a separate decision

`verifyLicenceToken()` answers one question: is this token authentic,
well-formed, and unexpired? It does **not** decide whether a `blocked`
status should restrict anything — a correctly-signed token whose claims
say `blocked` verifies as `ok: true`. That decision lives in
`workers/vf-app/src/licence-cache.ts`'s `isBlocked()`, deliberately
separate, so "is this real" and "should this stop the customer" can
never be accidentally conflated by a future change to one of them.

## The fail-open contract, and what "fail" actually covers

Blueprint: "Being unable to reach the licence server and failing to pay
are different events, and only the second may ever change behaviour...
An unreachable server must not silently unlock the paid tier."

`refreshLicenceCache()` treats three distinct failure modes identically
— none of them ever overwrite the cached state:

1. The fetch itself fails (network error, non-2xx).
2. The response fetches fine but fails signature verification.
3. The response verifies but the token has expired.

(2) is worth being explicit about: a response that arrives but doesn't
verify could be a forged or corrupted payload, not merely "the server
was unreachable." Treating it identically to an outright fetch failure
means a corrupted or spoofed response can never accidentally become a
worse outcome than silence — both paths leave the last known-good state
untouched, which is the one behaviour the Blueprint's principle actually
requires regardless of which specific way the fetch attempt went wrong.

## The bootstrap default: no cached state ever = blocked

This is **not** specified by the Blueprint and is this document's own
decision, made explicit rather than left implicit in code.

A brand-new `vf-app` instance, before its first successful scheduled
fetch, has no cached licence state at all — `readLicenceState()` returns
`{ known: false }`. `isBlocked()` treats this the same as an explicit
`blocked` status: mutating endpoints (`/rules/evaluate`,
`/rules/compile`) refuse until the first successful fetch lands.

The alternative — treating absence as implicitly entitled — was
rejected because it inverts the Blueprint's own principle: "must not
silently unlock the paid tier" is about not treating *unreachability*
as an unlock, and an instance that has *never* successfully reached the
control plane is unreachability in its purest form. The cost of this
choice is real and worth naming: a newly deployed instance is
non-functional (for the two gated endpoints) until either its first
scheduled fetch succeeds, or an operator runs it manually — there is no
"deploy vf-app, use it immediately" path today. If that latency proves
to be a real onboarding problem once real customers exist, the fix is
an explicit provisioning step that seeds a short-lived licence into the
cache directly (bypassing the fetch for the very first activation
only), not loosening this default globally.

## Token lifetime: independent of, and capped by, the licence's own validity

`workers/vf-licence/src/token-route.ts` issues tokens with a default
48-hour lifetime, capped at the licence's own `valid_to` if that's
sooner. The 48h figure is what forces the scheduled refresh
(`workers/vf-app/wrangler.jsonc`'s `triggers.crons`, currently every 6
hours) to actually matter — without a short token lifetime, an instance
could fetch once and never check in again for the life of a year-long
licence, which defeats the purpose of a scheduled refresh existing at
all. 6 hours between refresh attempts against a 48h token lifetime
leaves comfortable headroom for a missed run or two before anything
would actually expire.

## Config storage: a real JSON object in `vars`, not an escaped string

`LICENCE_SIGNING_PUBLIC_KEY` was originally stored as a JSON string
pasted into a `wrangler.jsonc` string value — meaning the operator had
to hand-escape every inner `"` in the JWK. This bit for real: on first
deploy, the private key (which happens to have a `d` field the public
key lacks, easy to not notice) got pasted into that slot by mistake,
was committed to a plaintext `vars` entry (not a secret), and briefly
went live — visible in the Cloudflare dashboard and `wrangler deploy`
output. Caught from the deploy output itself (the field width in the
CLI's truncated preview happened to show `"key_ops":["sign"]`, the
private key's own marker) before any real customer was provisioned,
and fully rotated: new keypair generated, old one confirmed never
committed to git (`git log -p --all` on the file: zero matches),
private key replaced in `vf-licence`'s secret, public key replaced in
`vf-app`'s var, both Workers redeployed.

Fixed properly rather than just more carefully: `wrangler.jsonc`
supports genuine nested JSON objects in `vars` (confirmed against
Cloudflare's own docs, not assumed — their own example:
`"SERVICE_X_DATA": { "URL": "...", "MY_ID": 123 }`), delivered to the
Worker already parsed on `env`, no `JSON.parse()` needed. The escaping
step — the actual source of the mistake — no longer exists as a step
at all, for this or any future customer's `wrangler.jsonc`.



- **Idempotent usage-period telemetry** (`usage_periods`, Blueprint's
  own next line after "the offline grace path"). This is additive —
  nothing about licence verification or enforcement depends on it
  existing — and bundling it with the licence-gating logic above would
  have mixed two unrelated concerns (does this customer have a valid
  licence vs. how much are they using) into one review.
- **The staged notice UI** ("notice in the product, then notice with a
  date, then restriction" — Blueprint). This bundle implements the
  restriction stage only. `statusReason` and `statusEffectiveAt` are
  already carried in the claims and the schema specifically so the
  earlier notice stages have somewhere to read from later, without a
  schema change — but nothing renders them yet.
- **Payment webhook and `payment_events`** — Blueprint's own words:
  "Payments last — the webhook is the easy part." No payment provider
  has been chosen; building this now would mean guessing at a vendor
  integration with nothing real to test it against.
- **Customer/licence admin UI.** `POST /customers` and `POST /licences`
  are raw API calls, not a dashboard — matching the precedent already
  set for `rule_sets` (also provisioned via direct D1/API calls, no UI
  yet).
