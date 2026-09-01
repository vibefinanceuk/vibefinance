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

## Locale-aware messages

The small, genuinely customer-facing subset of `vf-app`'s API
responses (rule-compile/confirm/activate validation messages, the
licence-blocked message) can be rendered in German, French, Spanish,
Italian, or Dutch instead of English, via a per-deployment `LOCALE` var
— the same "one Worker per customer, configured via vars" pattern
already used for `CUSTOMER_ID`. Most strings in this codebase are
deliberately *not* translated (operator/deployment errors, the
compiler's own LLM-generated text) — see
`docs/decisions/0008-locale-aware-messages.md` for exactly what's in
scope and why "translations & branding" turned out to be a much
smaller feature than it sounds, given there's no customer-facing UI
yet to attach branding to at all.

## Organisation, authority limits, and CIUS profiles

A customer's own org structure (`org_units`, optionally hierarchical),
real individual people (`org_users`), customer-definable roles built
from a closed permission vocabulary (`org_roles`), per-user monetary
approval ceilings (`org_authority_limits`), and which CIUS profile(s) a
customer issues/receives invoices under (`org_profiles`) — see
`docs/decisions/0009-org-authority-profiles.md`.

## User authentication and enforcement

Real people can now authenticate to `vf-app` with a per-user API key
(same generate-once, hash-only-stored pattern as `vf-licence`'s admin
and customer keys), and the rules workflow — compile, evaluate, review,
approve — actually checks permissions before letting anything through.
`confirmedBy`/`activatedBy` are derived from the authenticated identity,
never a client-supplied string. Permissions are namespaced by business
role category (`AP.*`, `AR.*`, `Admin.*`, `System.*`) — see
`docs/decisions/0010-user-authentication-and-enforcement.md`, including
what's deliberately not enforced yet (`/org/*` management, to avoid a
bootstrap deadlock; `/licence/refresh`, a deliberate escape hatch;
authority-limit enforcement, which has no integration point to attach
to today).

## Fleet tooling

`vf-licence`'s `customers` table now doubles as the fleet manifest —
`worker_name`, `d1_database_name`, `d1_database_id`, and `locale` per
customer, admin-authenticated via `GET /customers` and
`PATCH /customers/:id/fleet-metadata`. `migrations/migrate_all.py`
reads that manifest and runs `apply_migrations.py --remote` against
every customer with a database configured; `migrations/deploy_all.py`
reads the same manifest and deploys each customer's `vf-app` Worker,
constructing a real per-customer `wrangler.jsonc` at deploy time from
the one committed file rather than duplicating it — see
`docs/decisions/0011-fleet-tooling.md` and
`docs/decisions/0012-deploy-all.md`. Both scripts share the same
continue-on-error discipline (one customer's failure never stops the
rest of the fleet) and the same honest boundary: neither creates a D1
database or sets a secret — those remain deliberate, separate, manual
steps. Code-version reporting remains open.

## Rule versioning

`POST /rules/compile` accepts an optional `ruleId` to recompile an
existing rule into a new version rather than creating a brand new one
— `MAX(existing versions) + 1`, never a count. Activating a new
version closes the previously-open version's `effective_to` at the
exact moment the new one's `effective_from` begins: a clean handoff,
full history preserved, enforced by application logic and backed by a
partial unique index at the database layer. See
`docs/decisions/0014-rule-versioning.md`, including two real bugs
found by that safety net actually doing its job — a statement-ordering
mistake inside the activation batch, and the new migration never
having been wired into the test schema in the first place.

## A generic process/workflow engine (design only)

A substantial design conversation, not yet built: a stage-and-task
workflow engine serving AP, AR, and Expense Management alike, with
the existing rule interpreter as its deterministic decision layer.
Branching process definitions, subject-agnostic process instances,
team-plus-permission task eligibility, two distinct AI-agent shapes
(fact-producing vs. task-acting), and a shared historical-invoice-
facts query framework. See `docs/decisions/0015-process-workflow-
engine.md` for the full reasoning and every genuinely open question —
nothing in it is implemented yet.

## Teams

The first genuinely buildable slice of the process/workflow engine
design — `org_teams` and `org_team_members`, a group of users a task
could one day be assigned to and claimed by any member, deliberately
kept separate from `org_roles` (permission vs. routing are different
questions). No task, claiming, or eligibility logic yet — this is the
foundation those depend on. See `docs/decisions/0016-teams.md`.

## Invoice facts storage

`invoice_headers` and `invoice_lines` — the first real persistence of
invoice *facts* (as opposed to evaluation outcomes) anywhere in this
system, closing two of decision 0015's three named gaps at once.
`POST /invoices` upserts header and line facts; `POST /rules/evaluate`
now accepts an optional `facts` — when omitted, current persisted
facts are loaded by `invoiceId` instead, reusing that field rather
than adding a third one alongside `ruleSet`/`ruleSetId`. Facts are
deliberately mutable (an upsert, not versioned like `rule_versions`),
since decision 0015's fact-producing agents are meant to enrich them
over an invoice's lifecycle. See
`docs/decisions/0017-invoice-facts-storage.md`, including a real test-
writing lesson: an early version of the by-`invoiceId` test used a
rule set that matched even on completely empty facts, so it couldn't
actually prove real data was loaded.

## Process definitions and tasks

`processes` and `process_stages` — the definition layer of the
workflow engine, reusing the rule engine directly (one rule set per
stage). `route_to` is redefined to mean "advance to a specific stage,"
never "send to a team" as an earlier test rule once used it — a
deliberate change requiring no interpreter update at all, since action
params have always been opaque to the interpreter. `tasks` carry
exactly one owner (a team or a named user, enforced at the database
layer), with claiming and completing both implemented as single,
atomic conditional `UPDATE`s — proven by deliberately breaking the
atomicity and watching a real double-claim get caught before the fix
was restored. See `docs/decisions/0018-process-definitions-and-tasks.md`,
including a genuinely new authentication shape: claim/complete check a
*dynamic* permission (the task's own `required_permission`), not a
fixed one hardcoded to the route like every other permission-gated
route in this codebase.

## Process instances and stage visits — the workflow engine runs

`process_instances` and `stage_visits`/`stage_visit_steps` — the
runtime machinery 0018 deferred. A real invoice moves through a real
process's stages, each stage's rule set evaluated against supplied
facts, cascading freely through automatic stages and blocking only
where fired rules spawn real, open tasks — advancing again
automatically once the last one completes. Proven fully end to end
through the real router: a real invoice, a real approval task, claimed
and completed through the real `/tasks/:id/complete` route, the
instance confirmed to reach completion with no further explicit call.
See `docs/decisions/0019-process-instances-and-stage-visits.md`,
including an honest, deliberate scope boundary: task-completion-
triggered advancement only cascades through automatic stages, since
there are no facts available at that point to evaluate a real one.

## Accounts Receivable proves the vocabulary-sharing hypothesis

Decision 0015 flagged, without resolving, whether AP and AR could
genuinely share one field vocabulary. This checks it: a rule using
only existing vocabulary (`direction`, `older_than_days`,
`assign_task`) correctly fires AR collection tasks against overdue
receivables and correctly never fires against equally-overdue payables
— proven with zero production code changes, only new tests against
already-built infrastructure. `AR.Collect`, a permission noted as
having "zero backing capability" since decision 0009, gets its first
real use anywhere in this codebase. See
`docs/decisions/0021-accounts-receivable-vocabulary-test.md`, including
what this genuinely doesn't test — the real AI compiler, and whether
Expense (no EN 16931 grounding at all) would hold up the same way.

## Multi-vocabulary support, and Expense proves the harder hypothesis

The real infrastructure decision 0015 flagged as a prerequisite before
a second domain could exist: `isKnownField`, `validateRule`, the
compiler's prompt, and `compileRule` all gained an optional vocabulary
parameter, defaulting to `"invoice"` everywhere for full backward
compatibility. `rule_sets` gained a closed `vocabulary` column. A
genuinely new, authored Expense field vocabulary (`category`,
`amount`, `receipt_attached`, and others — no EN 16931 grounding at
all) then proved the harder hypothesis decision 0021 explicitly
deferred: a real expense rule correctly matches a large, receiptless
Travel expense and spawns a real task, and a single differing field
(a receipt being attached) correctly prevents it. Every change proven
by deliberately breaking it and watching a real test fail first. See
`docs/decisions/0022-expense-vocabulary.md`.

## "Intake" as a recommended first stage

`process_stages` never constrained stage names, so an "Intake" stage
needed no new infrastructure — this is a documented convention, not an
enforced one. `mandate.channel` (already in the closed vocabulary,
shared by AP and AR) had its description enriched with real example
values instead of a generic one, since the compiler's prompt renders
it verbatim; Expense gets its own analogous field, `intake.channel`,
rather than reusing a field named after an e-invoicing-specific term
that doesn't fit it. Both stay free strings — closed-value enforcement
(validating a condition's *value*, not just its field name) is a real,
previously unflagged gap this surfaced and deliberately declined to
build. See `docs/decisions/0023-intake-stage-convention.md`.

## Intake channels: a real, per-process managed list

A direct follow-up to 0023: not just a free string with example
values, but a genuine, customer-managed list — `intake_channels`,
scoped per process (not per vocabulary, since AP and AR share the
invoice vocabulary but need different channel lists), mirroring
`org_teams`'s own shape exactly. Adding a channel nobody anticipated
when a process was first set up is an ordinary API call, proven both
at the unit level and through the real router. Deliberately not wired
into rule validation — the same closed-value-enforcement question
decision 0023 already declined stays declined here too. See
`docs/decisions/0024-intake-channels.md`.

## Intake channel in the real routes, and Expense gets storage for the first time

`mandate_channel` promoted from an opaque part of `invoice_headers`'s
facts blob to a real, queryable column — small, cheap, fully backward
compatible. The bigger piece: `expense_reports` and `POST /expenses`
give Expense its first real storage anywhere, mirroring decision
0017's own invoice facts storage almost exactly — a single flat table
rather than a header/lines split, since Expense's own fields were
never modeled as a multi-line document the way an invoice genuinely
is. `POST /expenses` reuses `Expense.Submit`, its first real backing
anywhere in this codebase, and is licence-gated the same way
`/invoices` already is. Both confirmed live through the real router,
including a genuine permission-specific `403`. See
`docs/decisions/0025-intake-channel-in-routes-and-expense-storage.md`.

## The one rule enforced by tooling, not convention

No application code reads a tenant-scoped binding (`env.DB` and similar)
directly. Everything goes through `resolveTenant(request, env)` in
`shared/tenant.ts`. This is checked by ESLint
(`no-restricted-properties` in `eslint.config.js`), not left as a
comment — see decision 0001 for why.
