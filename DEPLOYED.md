# Last confirmed deployed

This file is the source of truth for `<base>` in every future bundle
(§4 of docs/change-and-promotion-model.md) — update it to the commit
SHA after you've confirmed a deploy landed, for **each** Worker, since
vf-app and vf-licence are promoted independently.

| Worker | commit SHA | confirmed at |
|---|---|---|
| vf-app | `c124e23` | 30 August 2026 — deploy output shows `env.LICENCE_SERVICE` bound to `vf-licence` (a Worker binding, not a var); `POST /usage/push` returned a real pushed report, confirmed to have genuinely landed via a direct D1 query on `vf-licence-poc` — the first confirmed-successful Worker-to-Worker call in this project, after `docs/decisions/0005-service-binding.md`'s fix |
| vf-licence | `119e3ca` | 30 August 2026 — last commit touching its code (the service-binding fix only changed `vf-app`); confirmed via that same successful `/usage/push` round trip landing a real row in `usage_periods` |

## D1

| database | last migration applied | confirmed at |
|---|---|---|
| vf-app-poc | 0002_licence_cache.sql (0001 also applied) | 30 August 2026 — `apply_migrations.py --remote` reports "nothing to apply", confirming both are recorded in the remote `_migrations` table |
| vf-licence-poc | 0002_usage_periods.sql (0001 also applied) | 30 August 2026 — confirmed functionally: a real `usage_periods` row for customer `Acme`, period `2026-08`, queried directly (`invoices_processed: 0, rules_evaluated: 0, active_users: null, outcome_counts_json: '{}'`), exactly matching what `vf-app` pushed |

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

