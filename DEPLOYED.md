# Last confirmed deployed

This file is the source of truth for `<base>` in every future bundle
(§4 of docs/change-and-promotion-model.md) — update it to the commit
SHA after you've confirmed a deploy landed, for **each** Worker, since
vf-app and vf-licence are promoted independently.

| Worker | commit SHA | confirmed at |
|---|---|---|
| vf-app | `077175b` | 31 August 2026 — rule versioning confirmed live, end to end. Recompiling under an ambiguous sentence ("flag anything over 1000 euros") was correctly refused by the model — genuine AI non-determinism, not a bug, confirmed by immediately retrying with an unambiguous sentence and getting `version: 2, isNewVersionOfExistingRule: true` for the exact same `ruleId`. Both v2 worked examples confirmed; activation confirmed v1's `effective_to` set to the exact same millisecond as v2's `effective_from` (`2026-08-31T15:14:07.248Z` both sides), via direct D1 query, not the response alone. The real proof: the same `BT-112: 3000` invoice that returned `no_match` under v1 on 30 August returned `matched` under v2 this time, with the response trace explicitly showing `ruleVersion: 2` as the one that actually fired. |
| vf-licence | `8029d0a` | 30 August 2026 — fleet tooling (Blueprint build order step 5) confirmed live, end to end. `GET /customers` and `PATCH /customers/:id/fleet-metadata` both confirmed working with a freshly rotated `ADMIN_API_KEY`; Acme's real fleet metadata (`worker_name`, `d1_database_name`, `d1_database_id`, `locale`) backfilled and confirmed persisted via a direct re-query, not inferred from the response alone. `migrations/migrate_all.py` (a local script, not a Worker — see its own row in the incident record below) then successfully read that manifest and ran a real migration check against Acme's live database: `1 succeeded, 0 failed, 0 skipped`. |

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

30 August 2026: fleet tooling (Blueprint build order step 5 — the
last item on the numbered list). `vf-licence`'s `customers` table
extended with deployment metadata rather than a separate manifest;
designing it surfaced a real, currently-blocking gap before it ever
caused a live failure — every customer's Worker needs a unique name,
which the config had never accounted for. `migrations/migrate_all.py`
built on top of the already-proven `apply_migrations.py`, with
continue-on-error proven by deliberately breaking it (stop on first
failure) and watching a specific test catch a customer being skipped
entirely. Confirmed live end to end: the fleet manifest read with a
real admin key, Acme's real metadata backfilled and persisted, and a
genuine `1 succeeded, 0 failed, 0 skipped` migration run against
Acme's live database. Full account in
`docs/decisions/0011-fleet-tooling.md`.

30 August 2026: the first live run of `migrate_all.py` hit two real
environment issues neither could be caught from this development
session, which has no path to live Cloudflare infrastructure at all.
First, a macOS Python certificate-trust gap (`SSLCertVerificationError`
— python.org's installer doesn't wire up trusted root certificates by
default; fixed by running the bundled `Install Certificates.command`).
Second, and more interesting: Cloudflare's own edge-level bot
protection rejected the request outright with a plain-text
`error code: 1010`, confirmed against Cloudflare's own error-code
documentation — Python's default `urllib` User-Agent
(`Python-urllib/3.x`) is a well-known, easily fingerprinted non-browser
signature. Fixed by sending a real, honest User-Agent
(`VibeFinance-migrate-all/1.0`) rather than impersonating a browser,
since this is the operator's own infrastructure calling itself, not a
third party being scraped. A new test exercises the previously-
untestable request-construction code directly (mocking
`urllib.request.urlopen`, no live network needed) and was confirmed to
catch the exact regression by deliberately reverting the fix first.

30 August 2026: `deploy_all.py` (Blueprint build order step 5, the
second and final half of fleet tooling — decision 0012) hit a real
bug on its first genuine live run: `"The entry-point file at
'src/index.ts' was not found."` A subtle path-resolution mistake —
the generated per-customer config lived one directory level deeper
than the real `wrangler.jsonc`, silently breaking `main`'s relative
path — found despite having correctly verified the *general*
principle against Cloudflare's own docs beforehand; verifying a
principle and applying it correctly everywhere it matters turned out
to be two different things worth checking separately. Fixed by
writing generated configs as flat files, no subdirectory, confirmed
by a new test that resolves `main` exactly the way `wrangler` itself
does, against a real file on disk.

Confirmed live immediately after, twice over: `deploy_all.py
--customer Acme` reported `1 succeeded, 0 failed, 0 skipped` with a
real Cloudflare `Current Version ID`; then, separately,
`POST /licence/refresh` against the freshly redeployed Worker
returned `{"status":"refreshed",...}` — confirming the redeploy left
`VF_LICENCE_API_KEY`, the Service Binding to `vf-licence`, and the
whole authentication chain genuinely intact, not just that the deploy
command exited cleanly. Full account in
`docs/decisions/0012-deploy-all.md`.

31 August 2026: rule versioning confirmed live. Recompiling the exact
rule activated on 30 August, under the ambiguous sentence "flag
anything over 1000 euros," was correctly refused by the model — the
same sentence that had compiled unambiguously the first time, a real,
expected instance of AI output non-determinism rather than a bug, and
confirmed a refused recompile left the rule's existing version
completely untouched before retrying. An unambiguous sentence
("the total amount with VAT is over 1000 euros") compiled cleanly to
`version: 2` of the same `ruleId`. Both v2 worked examples confirmed;
activating v2 was confirmed, via direct D1 query, to have set v1's
`effective_to` to the exact same millisecond as v2's `effective_from`
— a genuinely clean handoff, not just a claimed one. The real proof
this whole feature exists for: the identical `BT-112: 3000` invoice
that returned `no_match` on 30 August (under v1's 5000 threshold)
returned `matched` this time under v2's 1000 threshold, with the
response's own trace explicitly naming `ruleVersion: 2` as the one
that fired. Full account in `docs/decisions/0014-rule-versioning.md`.
