# Last confirmed deployed

This file is the source of truth for `<base>` in every future bundle
(§4 of docs/change-and-promotion-model.md) — update it to the commit
SHA after you've confirmed a deploy landed, for **each** Worker, since
vf-app and vf-licence are promoted independently.

| Worker | commit SHA | confirmed at |
|---|---|---|
| vf-app | `0a2b61c` | 30 August 2026 — `POST /usage/push` succeeds end-to-end with `VF_LICENCE_API_KEY` configured (a real secret, not a var); a real, freshly-timestamped row landed in `vf-licence-poc`'s `usage_periods`, confirmed via direct D1 query, not inferred from the HTTP response |
| vf-licence | `0a2b61c` | 30 August 2026 — `POST /customers/Acme/rotate-key` succeeded with the real `ADMIN_API_KEY`; the resulting per-customer key was confirmed to actually authenticate (`POST /usage/push` from `vf-app` succeeded using it); separately confirmed `POST /usage` correctly rejects an unauthenticated request (`{"error":"unauthorized"}`) claiming inflated numbers for `Acme` — the real security property, not just the happy path |

## D1

| database | last migration applied | confirmed at |
|---|---|---|
| vf-app-poc | 0002_licence_cache.sql (0001 also applied) | 30 August 2026 — `apply_migrations.py --remote` reports "nothing to apply", confirming both are recorded in the remote `_migrations` table |
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

