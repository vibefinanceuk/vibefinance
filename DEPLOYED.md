# Last confirmed deployed

This file is the source of truth for `<base>` in every future bundle
(§4 of docs/change-and-promotion-model.md) — update it to the commit
SHA after you've confirmed a deploy landed, for **each** Worker, since
vf-app and vf-licence are promoted independently.

| Worker | commit SHA | confirmed at |
|---|---|---|
| vf-app | `922d003` | 30 August 2026 — `/health` ok; `scripts/verify-live-key-match.mjs` confirmed a real token, freshly signed by vf-licence's live private key, verifies correctly against vf-app's configured public key (real ECDSA verification, not a test double) |
| vf-licence | `922d003` | 30 August 2026 — `/health` ok; `POST /customers`, `POST /licences`, and `GET /licences/:id/token` all confirmed live against a real customer (`Acme`) — a real signed token was issued and independently verified (see vf-app's row) |

## D1

| database | last migration applied | confirmed at |
|---|---|---|
| vf-app-poc | 0002_licence_cache.sql (0001 also applied) | 30 August 2026 — `apply_migrations.py --remote` reports "nothing to apply", confirming both are recorded in the remote `_migrations` table |
| vf-licence-poc | 0001_control_plane_schema.sql | 30 August 2026 — confirmed functionally: `customers` and `licences` tables are genuinely in use (a real customer + licence were created and a token was issued from them) |

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

