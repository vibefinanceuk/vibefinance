# Last confirmed deployed

This file is the source of truth for `<base>` in every future bundle
(§4 of docs/change-and-promotion-model.md) — update it to the commit
SHA after you've confirmed a deploy landed, for **each** Worker, since
vf-app and vf-licence are promoted independently.

| Worker | commit SHA | confirmed at |
|---|---|---|
| vf-app | `cd3d847` | 30 August 2026 — user authentication and enforcement confirmed live, end to end. A real `org_users` row (Alice) created; `POST /rules/compile` correctly returned `401` with no credentials and succeeded with Alice's real key. `POST .../confirm` and `POST .../activate` called with no `confirmedBy`/`activatedBy` in the body at all — both correctly recorded `alice@acme.com` anyway, derived entirely from her authenticated key, confirmed via direct D1 query (`approved_by: "alice@acme.com"`), not inferred from the HTTP response alone. |
| vf-licence | `0a2b61c` | 30 August 2026 — `POST /customers/Acme/rotate-key` succeeded with the real `ADMIN_API_KEY`; the resulting per-customer key was confirmed to actually authenticate (`POST /usage/push` from `vf-app` succeeded using it); separately confirmed `POST /usage` correctly rejects an unauthenticated request (`{"error":"unauthorized"}`) claiming inflated numbers for `Acme` — the real security property, not just the happy path |

## D1

| database | last migration applied | confirmed at |
|---|---|---|
| vf-app-poc | 0003_org_authority_profiles.sql (0001, 0002 also applied) | 30 August 2026 — `apply_migrations.py --remote` reports "applied" for 0003; all six new tables confirmed genuinely holding related data together via a live join query (`org_users` × `org_user_roles` × `org_roles` × `org_authority_limits`), not just isolated single-table inserts |
| vf-licence-poc | 0003_customer_api_keys.sql (0001, 0002 also applied) | 30 August 2026 — `apply_migrations.py --remote` reports "applied" for 0003; `Acme`'s `api_key_hash` confirmed populated (previously `NULL`) via the successful rotate-key + authenticated usage-push round trip |

## Incident record

29–30 August 2026: a private key was briefly, mistakenly deployed to
`vf-app` as a plain (non-secret) `vars` entry, due to
`LICENCE_SIGNING_PUBLIC_KEY` being stored as a hand-escaped JSON string
— exactly the kind of thing that's easy to get subtly wrong by hand.
Caught from `wrangler deploy`'s own output before any real customer was
provisioned. Fully rotated (new keypair; old one confirmed via
`git log -p --all` to have never been committed to git) and the
underlying storage format fixed (`vars` now holds a genuine nested JSON
object, no escaping possible) so the same mistake can't recur the same
way. Full account in `docs/decisions/0003-licensing-signed-token.md`.

30 August 2026: `vf-app`'s Worker-to-Worker calls to `vf-licence`
(licence-token fetch, usage push) silently 404'd in production — a
Cloudflare platform restriction (a Worker cannot plain-`fetch()`
another Worker's `workers.dev` URL from inside its own handler), not a
config mistake. Never previously exercised in production; caught the
first time `POST /usage/push` was tried live. Fixed with a Service
Binding. The licence-refresh cron — which makes the identical kind of
call, and had never fired yet — would have failed the same way,
silently, forever, had this not been caught first. Full account in
`docs/decisions/0005-service-binding.md`.

30 August 2026: none of `vf-licence`'s three endpoints
(`POST /customers`, `POST /licences`, `POST /usage`) had any
authentication — flagged as a known gap in
`docs/decisions/0004-usage-telemetry.md` rather than left silent, then
closed the same day. Admin auth (a shared secret) for provisioning;
per-customer keys (generated once, only their hash stored) for the
machine-to-machine calls each customer's own `vf-app` instance makes.
`Acme`, live before this existed, backfilled a key via the new
rotation endpoint without downtime — confirmed both that the new key
works and that an unauthenticated request is genuinely rejected, not
just that the happy path succeeds. Full account in
`docs/decisions/0006-endpoint-authentication.md`.

30 August 2026: the first real attempt to compile a rule after
deploying worked-examples/activation hit `{"error":"processing
blocked","reason":"no licence has been provisioned for this instance
yet"}` — `licence_cache` had never been populated, since the only
thing that writes it (the 6-hourly `scheduled()` cron) genuinely
hadn't fired yet since `VF_LICENCE_API_KEY` was configured. Confirmed
directly (`SELECT * FROM licence_cache` returned nothing) before
building the fix: `POST /licence/refresh`, an on-demand equivalent,
deliberately not licence-gated (gating it would make the exact
bootstrap-blocked state it exists to fix permanently unrecoverable via
the API). Full account in `docs/decisions/0007-rule-approval.md`'s
addendum.

30 August 2026: `generateExamples` (the worked-examples step of rule
compilation) failed live with `finish_reason: "length"`,
`content: null` — `gpt-oss-120b`, a reasoning model, had spent its
entire response budget on internal chain-of-thought before ever
writing the JSON answer. Confirmed against Cloudflare's own changelog
that `max_tokens` defaults to 256, far too small for a reasoning
model's combined reasoning-plus-answer output; `compiler-model.ts` had
never set it explicitly. Fixed with `max_tokens: 4096`. Confirmed live
immediately after: the same compile request that previously refused
its examples produced `examples.status: "generated", count: 2`, and
the full compile→confirm→activate pipeline completed successfully
end-to-end for the first time. Full account in
`docs/decisions/0002-compiler-model-choice.md`.

30 August 2026: closed the scope boundary named explicitly when rule
activation shipped — until this point, activating a rule updated
`rule_versions` in D1 but `POST /rules/evaluate` never loaded from D1
at all, only from an inline request body. `rule-set-loader.ts` now
loads exactly the rules that are enabled, approved, and currently
effective; `POST /rules/evaluate` accepts a `ruleSetId` alongside the
original inline `ruleSet` (kept, for reproducibility). Confirmed live
in both directions with the exact rule activated earlier in the same
session: `BT-112: 8640` → `"matched"`, `BT-112: 3000` → `"no_match"` —
the same activated rule correctly firing and correctly staying silent,
loaded from D1 both times. Full account in
`docs/decisions/0007-rule-approval.md`.

30 August 2026: locale-aware messages (Blueprint build order step 6,
narrowed to the small, genuinely customer-facing subset of `vf-app`'s
API — most strings in this codebase are operator/deployment-facing and
deliberately not translated). Confirmed live across two independent
routes: `LOCALE: "de"` produced the correct German text for both
`/rules/evaluate`'s validation message and `/rules/compile`'s 404,
proving the translation wiring is consistent rather than a single
lucky path. Full account in
`docs/decisions/0008-locale-aware-messages.md`.

30 August 2026: the org/authority/profiles schema (schema plus a
minimal CRUD API, deliberately no authentication or enforcement yet —
a scope chosen explicitly before writing any code). CIUS profile
identifiers were verified against a live web search before being
hardcoded, given this whole product's purpose is EN 16931/Peppol
compliance. Confirmed live: a unit, a user, a role built from the
closed permission vocabulary, a role assignment, and an authority
limit, all created successfully, then confirmed genuinely related via
a single query joining four of the six new tables; separately
confirmed a role with an unknown permission is correctly refused
(`422`), the closed vocabulary actually holding on real infrastructure,
not just in tests. Full account in
`docs/decisions/0009-org-authority-profiles.md`.

30 August 2026: user authentication and enforcement (closes the
largest gap left by decision 0009). Confirmed live end to end: a real
user (Alice) created via `POST /org/users`; `POST /rules/compile`
correctly `401`'d with no key and succeeded with hers; the confirm and
activate steps were called with no `confirmedBy`/`activatedBy` in the
body at all, yet both correctly recorded her real identity
(`alice@acme.com`) anyway — proving the fields are genuinely derived
from the authenticated key, not accepted from the client. A real
`wrangler` authentication hiccup was hit and resolved mid-deployment
(a stale OAuth session — fixed with `wrangler login`), unrelated to
this bundle's own code. Full account in
`docs/decisions/0010-user-authentication-and-enforcement.md`.
