# 0016 — Teams

Status: settled, 31 August 2026. The first genuinely buildable slice
out of decision 0015's process/workflow engine design — chosen
specifically because it has zero dependency on any of that document's
open questions (cost centre vs. `org_units`, hierarchy flow-down, the
vocabulary strategy, or the `agent_approve` question), and because
every other buildable piece named there (tasks, process definitions,
stage visits) needs teams to exist first.

## Schema, deliberately minimal

Two tables: `org_teams` (id, name) and `org_team_members`, a plain
many-to-many join to `org_users` — the same shape as `org_roles` /
`org_user_roles` already established in decision 0009. A user can
belong to more than one team (a real AP team and a real Expense team
might well share members); a team obviously holds more than one
person. No task assignment, no claiming, no eligibility checking —
this migration creates the data those future features depend on, not
the features themselves.

## Deliberately separate from `org_roles`, per decision 0015

`org_roles` answers a permission question — is this person allowed to
do this at all, ever. A team answers a routing question — whose queue
does a task land in. Confirmed directly in the design conversation
that these are genuinely different axes: two teams could hold the
exact same permission while working entirely separate queues. Reusing
`org_roles` for this would have collapsed that distinction; a
separate table keeps it available for whatever eligibility model
tasks eventually implement (decision 0015's own answer: team
membership AND permission, composed with AND).

## Deliberately unauthenticated, matching every other `/org/*` route

`POST /org/teams` and `POST /org/teams/:id/members` are not gated by
any permission, for the same reason `org_units`/`org_users`/
`org_roles` aren't (decision 0010): this is administrative/setup
activity, and requiring a permission to create the infrastructure
that permission-checking itself depends on risks the exact bootstrap
deadlock avoided everywhere else in this subsystem.

## Defense in depth, confirmed rather than assumed

The duplicate-membership check in `team-route.ts` was deliberately
removed and the test suite rerun to confirm what happens without it:
the composite `PRIMARY KEY (team_id, user_id)` on `org_team_members`
itself refuses the duplicate insert — a raw database error rather than
the clean `409` the application-level check exists to produce, but
genuine protection at the schema layer regardless of whether the
application code has a bug. The same discipline applied throughout
this project: application logic enforces a property, and the schema
makes it structurally impossible for that logic to fail silently.

## What's still open

- No `DELETE` route to remove a team member — matches the same
  minimal-CRUD precedent already established for `org_user_roles`
  (no un-assign route either), not an oversight.
- No `GET`/list route for a team's members or a user's teams — same
  "raw API for now" precedent as the rest of `/org/*`.
- Tasks, process definitions, stage visits, and the eligibility check
  that actually *uses* team membership (team AND permission) remain
  entirely unbuilt — this bundle is the foundation, not the feature.
