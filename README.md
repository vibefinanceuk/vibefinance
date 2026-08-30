# VibeFinance

An invoice-processing product a one-person company can run: per-customer
data, a single codebase, and business rules a model writes but never
executes. See `docs/VibeFinance_Blueprint` context (not checked in here —
it's the design document this repo implements) and
`docs/decisions/0001-worker-split-and-tenant-resolution.md` for the
architecture this scaffold follows.

**How changes get made**: see `docs/change-and-promotion-model.md`. In
short — an assistant session authors and tests changes in a sandbox it
cannot push or deploy from, hands them over as git bundles, and a human
operator promotes them to GitHub and Cloudflare. `DEPLOYED.md` tracks
what's actually confirmed live.

## Layout

```
shared/                  interpreter, compiler, licensing, usage, tenant resolution — imported by Workers
  interpreter/            the closed-vocabulary rule engine (vocabulary, types, evaluate)
  compiler/               NL-to-rule compiler: prompt, refusal boundary, vendor-agnostic model interface
  licensing/              signed licence tokens: sign/verify (real Web Crypto, no mocks needed)
  usage/                  the UsageReport shape both Workers agree on
  tenant.ts                the one place a tenant-scoped binding may be touched
workers/
  vf-app/                 the product Worker (interpreter, compiler, licence cache/enforcement, usage push, evaluate/compile routes)
  vf-licence/              the control-plane Worker (customers, licences, signed tokens, usage ingestion)
    migrations/             its own independent chain, against a different database — see --migrations-dir below
migrations/               numbered, append-only SQL chain for vf-app-poc + the runner
scripts/
  generate-licence-keypair.mjs   run locally to generate the real signing key — never in chat, never committed
  verify-live-key-match.mjs      confirms a live vf-app/vf-licence keypair actually match, without printing either
docs/
  change-and-promotion-model.md
  decisions/               recorded architecture decisions and alternatives considered
```

## Running things

```bash
npm install           # legacy-peer-deps is set in .npmrc — required, see
                       # docs/change-and-promotion-model.md's "known divergences"
npm test               # all workspaces
npm run lint            # includes the no-direct-env.DB check

python3 migrations/apply_migrations.py --replay-only   # vf-app-poc's chain
python3 migrations/apply_migrations.py --replay-only --migrations-dir workers/vf-licence/migrations   # vf-licence-poc's chain
```

Per-Worker: `cd workers/vf-app && npx vitest run` runs that Worker's
tests inside the real workerd runtime against a real (local) D1 binding,
not a mock. `shared/licensing/`'s sign/verify tests are real too — Web
Crypto works identically in tests and production, so nothing there is
mocked either.

## Licensing

`vf-licence` issues signed tokens; `vf-app` fetches, verifies and caches
them, failing open (never blocking) on an unreachable server, and
failing closed (blocking) if it's never successfully fetched one at
all. See `docs/decisions/0003-licensing-signed-token.md`. The signing
keypair is generated locally with `scripts/generate-licence-keypair.mjs`
— the private key is never pasted into chat or committed.

## Usage telemetry

`vf-app` reports counts-only usage (invoices processed, rules
evaluated, outcome breakdown — never supplier names, amounts, or
anything re-identifiable) to `vf-licence`, idempotently keyed on
`(customer_id, period_key)`. The same push logic runs on the licence
refresh's cron and behind `POST /usage/push` for on-demand reporting —
see `docs/decisions/0004-usage-telemetry.md` for why those are the same
capability, not two different code paths.

## Worked examples and rule activation

Every compiled rule also gets worked invoice examples generated for
it, re-verified against the real interpreter before being stored (the
model's own claim about whether an example matches is never trusted
blindly). A rule can only be activated once every example is confirmed
by a person, and `POST /rules/evaluate` now loads exactly the
currently-activated, currently-effective rules for a rule set directly
from D1 (`ruleSetId` in the request, alongside the original inline
`ruleSet` option, kept for testing and reproduction) — see
`docs/decisions/0007-rule-approval.md`. That doc also covers
`POST /licence/refresh`, an on-demand alternative to the 6-hourly cron
for when a freshly (re)configured instance can't afford to wait.

## Endpoint authentication

`vf-licence`'s provisioning endpoints (`POST /customers`,
`POST /licences`, key rotation) are protected by a single shared
`ADMIN_API_KEY`. Each customer's own machine-to-machine calls
(`GET /licences/:id/token`, `POST /usage`) are protected by a random
key generated for that customer at creation — shown once in plaintext,
only its hash ever stored, and critically, one customer's key can never
authenticate as another. See
`docs/decisions/0006-endpoint-authentication.md`, including the exact
operational sequencing this requires on first deploy.

## The one rule enforced by tooling, not convention

No application code reads a tenant-scoped binding (`env.DB` and similar)
directly. Everything goes through `resolveTenant(request, env)` in
`shared/tenant.ts`. This is checked by ESLint
(`no-restricted-properties` in `eslint.config.js`), not left as a
comment — see decision 0001 for why.
