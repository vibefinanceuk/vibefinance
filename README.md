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
shared/                  interpreter, compiler, licensing, tenant resolution — imported by Workers
  interpreter/            the closed-vocabulary rule engine (vocabulary, types, evaluate)
  compiler/               NL-to-rule compiler: prompt, refusal boundary, vendor-agnostic model interface
  licensing/              signed licence tokens: sign/verify (real Web Crypto, no mocks needed)
  tenant.ts                the one place a tenant-scoped binding may be touched
workers/
  vf-app/                 the product Worker (interpreter, compiler, licence cache/enforcement, evaluate/compile routes)
  vf-licence/              the control-plane Worker (customers, licences, signed tokens)
    migrations/             its own independent chain, against a different database — see --migrations-dir below
migrations/               numbered, append-only SQL chain for vf-app-poc + the runner
scripts/
  generate-licence-keypair.mjs   run locally to generate the real signing key — never in chat, never committed
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

## The one rule enforced by tooling, not convention

No application code reads a tenant-scoped binding (`env.DB` and similar)
directly. Everything goes through `resolveTenant(request, env)` in
`shared/tenant.ts`. This is checked by ESLint
(`no-restricted-properties` in `eslint.config.js`), not left as a
comment — see decision 0001 for why.
