# Last confirmed deployed

This file is the source of truth for `<base>` in every future bundle
(§4 of docs/change-and-promotion-model.md) — update it to the commit
SHA after you've confirmed a deploy landed, for **each** Worker, since
vf-app and vf-licence are promoted independently.

| Worker | commit SHA | confirmed at |
|---|---|---|
| vf-app | `11670e4` | 4 September 2026 — `GET /whoami` (decision 0095), version `8af6a362`. **The authentication chain proven end to end against production**: a password verified in `vf-licence`, a token signed and scoped to `Acme-production`, and `vf-app` verifying it locally with no network call — returning Alice's real record and seven permissions merged across both her roles, with `authenticatedVia: "session"`. Signing in for `Acme-production-us`, an environment deleted earlier that day, was refused with the **identical message** as a wrong password, which is what stops an email address becoming an enumeration tool. Sessions and API keys coexist deliberately; every previous test in this project used a key and none stopped working. Earlier the same day: purchase orders (0081, migration 0034) and the corrected `ap-live` process definition (0080).
| vf-licence | `67a1d95` | 4 September 2026 — **closes a live authentication bypass** (decision 0097). `POST /credentials`, `POST`/`DELETE /access` and `PUT /branding/:id` had each been added above the point where `isAdminRoute` is computed, so every handler returned before the gate ran and their entries in that expression were dead code. The first two together let anybody set a password for any email, grant it access and sign in with a valid session token. Found by the operator running a command with `YOUR_ADMIN_KEY` left in literally — it worked, and so did `Bearer sadfgsfsfg`. Verified after the fix: both are refused with `unauthorized`, and `user_credentials` holds only the two accounts created deliberately, so nothing exploited the window. Also carrying branding (0096, migration 0012), login (0094) and credentials with the composite keys that make a cross-customer grant impossible (0092, 0093).

| vf-ui | `1705711`+ | 5 September 2026 — a **backend-for-frontend** (decision 0102). The session token now lives in an `HttpOnly` cookie and never enters JavaScript; RFC 10017 is blunt that no browser API stores a token securely, so `localStorage` and `sessionStorage` were never the choice they appeared to be. **Confirmed live**: opening `/api/whoami` after a refresh returned Alice with her permissions — the cookie persisted, `vf-ui` attached the token, and `vf-app` verified it. The first deploy failed with `error code: 1042`, which decision 0005 already documented in August: a Worker cannot plain-`fetch()` another Worker's `workers.dev` URL on the same account. Fixed with a Service Binding for `vf-licence` and the `global_fetch_strictly_public` flag for the per-customer instances, where a binding cannot work because `vf-ui` is one shared deployment.

## D1

| database | last migration applied | confirmed at |
|---|---|---|
| vf-app-poc | 0034_purchase_orders.sql | 3 September 2026 — applied through 0029. `sources` holds one row backfilled from `intake_channels` under the same id (`ic-new`, `https`, `legacy_channel_id` matching), so stored `mandate.channel` values keep resolving. `intake_channels` holds four rows for `ap-live`: the legacy row at `structure = NULL`, plus `ap-live-xml`, `ap-live-pdfa` and `ap-live-image`. All four confirmed carrying identical extraction settings after 0029 — a no-op here, since `ic-new` was never configured away from the defaults. The seeding in 0028 and the copy in 0029 were additionally exercised locally against seeded data, because the migration replay uses an empty database where both would have been vacuously verified.
| vf-licence-poc | 0012_branding.sql | 2 September 2026 — applied through 0007; `warned_at_days` confirmed recording which threshold fired, verified live against `northwind-sandbox` and then restored. Recorded from the previous session's confirmation rather than re-verified today |

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

31 August 2026: invoice facts storage confirmed live, including a
real live catch worth recording. The first evaluation against a
freshly stored invoice (`facts: {"BT-40":"US"}`, no `BT-112`) came
back `no_match` — a correct result, but not distinguishing proof: the
same result would occur if fact-loading had silently failed and
defaulted to empty facts, exactly the ambiguity the automated test
suite's own first draft was separately caught producing and fixed
before being trusted (see `docs/decisions/0017-invoice-facts-
storage.md`). The same standard was applied live rather than accepted
on the first, ambiguous result: the invoice was updated with
`BT-112: 3000`, and re-evaluated with no `facts` field in the request
at all. The response came back `matched`, with the trace explicitly
showing `ruleVersion: 2, matched: true` on the rule whose 1000
threshold 3000 clears and the older rule's 5000 threshold does not —
genuine, unambiguous confirmation that persisted facts were loaded
from D1 and actually used, not inferred from a result that could have
meant either outcome.

31 August 2026: the full workflow engine confirmed live, end to end
— and two real bugs live testing itself caught along the way, neither
found in review. First: the first real compile of an `assign_task`
rule against the deployed engine produced
`{"assignee": "AP team", "required_permission": "AP.Approve"}` —
plausible-sounding, and completely incompatible with what the engine
actually reads. Root cause: `ACTIONS` had no `FIELD_DESCRIPTIONS`-style
completeness discipline at all, so nothing had ever told the compiler
what params shape any action expects. Fixed by adding
`ACTION_DESCRIPTIONS`, mirroring the existing field discipline
exactly, correcting the compiler's own stale worked example at the
same time (`docs/decisions/0018-process-definitions-and-tasks.md`'s
own addendum). Second, hit immediately after redeploying: adding
Alice to the resulting team (named `"AP team"`, with a space, by the
compiler itself) failed with `"team AP%20team does not exist"` —
`URL.pathname` had never actually been decoded anywhere in
`index.ts`, so every dynamic path segment across eleven separate
routes was silently receiving raw, still-encoded text. Fixed once, at
the root, rather than patched at each call site
(`docs/decisions/0020-url-path-decoding.md`).

With both fixed and redeployed, the full run: a real invoice instance
was created and visited with `BT-112: 3000`, cascading automatically
through the automatic `Received` stage before the real, activated
rule at `Approval` genuinely matched and spawned one real task —
confirmed via direct D1 query (`owner_team_id: "AP team"`,
`required_permission: "AP.Approve"`), not the response alone. That
task was claimed and completed by Alice through the real
`/tasks/:id/claim` and `/tasks/:id/complete` routes, and a fresh D1
query confirmed the instance had advanced itself all the way to
`status: "completed"`, `current_stage_id: "payment-eligible"` — with
no further explicit call after completing the task. The exact
property `docs/decisions/0019-process-instances-and-stage-visits.md`
was built around, proven for real rather than only in a test.

1 September 2026: duplicate detection and the structured-column-merge
fix (decision 0028) confirmed deployed and pushed, per the person's
own report — recorded honestly, not overstated: no live walkthrough
was performed for this one. Everything behind it was proven locally —
422 tests including the weighted scoring's own critical properties
(the supplier gate refusing to score coincidental cross-supplier
matches; an original invoice's own stored score confirmed unchanged
after a near-identical later submission arrives; the real prerequisite
bug — structured columns never reaching rule evaluation — deliberately
reproduced and confirmed to fail before the fix was trusted) — and a
fresh-clone sweep before the bundle was ever handed off, but nothing
here has yet been directly exercised against the real, running
deployment the way the workflow engine and per-line evaluation were.

1 September 2026: real UBL invoice parsing (decision 0030) confirmed
live, end to end, including a real deploy issue and a real bug found
along the way, both resolved and confirmed before this was trusted.
The first deploy attempt failed with "Could not resolve
fast-xml-parser" -- diagnosed properly rather than guessed at, by
reproducing the exact same bundling step locally via `wrangler deploy
--dry-run` (which succeeded), narrowing the cause to `npm install`
never having been run after pulling the bundle. Confirmed correct:
running it fixed the real deploy.

With that resolved, a genuine Peppol BIS Billing 3.0 XML document was
sent as a raw POST to a real intake channel on the original `ap-live`
process. It correctly parsed every field, cascaded through the
automatic `received` stage on its own, and correctly matched the
real, pre-existing `BT-112 > 1000` rule -- confirmed via a direct D1
query, not the response alone. That same live check surfaced a real,
honest mistake: an assumption stated in conversation that the
invoice's id would default to its own invoice number was wrong --
the code deliberately generates a fresh UUID instead, exactly as
decision 0030 already documented, and the mistake was owned and
corrected in the same turn rather than left standing. Querying by
`invoice_number` instead confirmed every field was genuinely correct.

That same check surfaced a second, real gap: the capture response
never actually returned the invoice's own generated id at all, so a
caller had no way to look their own row up afterward except by a
field like `invoice_number`. Fixed generally in `handleCaptureIntake`
itself, proven by deliberate revert-and-reproduce locally, then
confirmed live a second time: a repeat capture through the same real
channel came back with a real `id` field present directly in the
response.

1 September 2026: cost centre vs. `org_units` (decision 0031)
confirmed live. `POST /org/cost-centres` created a real cost centre
(`CC-100`, "Engineering") against production infrastructure. The
larger, more technically substantial half of this decision — `BT-133`
added to the closed vocabulary, `parseUblInvoice` extended to extract
it, and the full raw-XML-to-fired-rule pipeline correctly matching a
real per-line rule on a real cost centre reference — was already
proven live in the same session as decision 0030's own confirmation;
this entry closes the loop on the newer piece specifically: the real,
customer-managed list itself, genuinely reachable and working end to
end against the real deployment.
