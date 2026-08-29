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
shared/                  interpreter, compiler, tenant resolution — imported by Workers
  interpreter/            the closed-vocabulary rule engine (vocabulary, types, evaluate)
  compiler/               NL-to-rule compiler: prompt, refusal boundary, vendor-agnostic model interface
  tenant.ts                the one place a tenant-scoped binding may be touched
workers/
  vf-app/                 the product Worker (interpreter, compiler, evaluate/compile routes)
  vf-licence/              the control-plane Worker (customers, licences, usage)
migrations/               numbered, append-only SQL chain + the runner
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

python3 migrations/apply_migrations.py --replay-only   # validate the migration chain
```

Per-Worker: `cd workers/vf-app && npx vitest run` runs that Worker's
tests inside the real workerd runtime against a real (local) D1 binding,
not a mock.

## The one rule enforced by tooling, not convention

No application code reads a tenant-scoped binding (`env.DB` and similar)
directly. Everything goes through `resolveTenant(request, env)` in
`shared/tenant.ts`. This is checked by ESLint
(`no-restricted-properties` in `eslint.config.js`), not left as a
comment — see decision 0001 for why.
