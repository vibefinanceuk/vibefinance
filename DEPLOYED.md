# Last confirmed deployed

This file is the source of truth for `<base>` in every future bundle
(§4 of docs/change-and-promotion-model.md) — update it to the commit
SHA after you've confirmed a deploy landed, for **each** Worker, since
vf-app and vf-licence are promoted independently.

| Worker | commit SHA | confirmed at |
|---|---|---|
| vf-app | `d63f392` | 29 August 2026 — `/health` ok; `POST /rules/compile` confirmed live end-to-end (real Workers AI call → correct field selection → D1 persistence with `approved_by` null) |
| vf-licence | `e2a4bcc` | 29 August 2026 — https://vf-licence.vibefinance.workers.dev/health returns `{"status":"ok"}` (unchanged since — no code changes to this Worker since its last deploy) |

## D1

| database | last migration applied | confirmed at |
|---|---|---|
| vf-app-poc | 0001_rule_engine_schema.sql | 29 August 2026 |
| vf-licence-poc | _none — no schema exists yet, control-plane skeleton only_ | |
