# 0009 — org/authority/profiles: schema plus minimal CRUD, no auth or enforcement

Status: settled, 30 August 2026. The Blueprint's org/authority/profiles
subsystem — the piece flagged as "not started" every time the
remaining task list was reviewed, and the direct answer to "once real
user sessions exist, locale would come from them" raised right before
this bundle: that needs an actual per-user identity model, which
didn't exist anywhere in this system before this.

## Scope, chosen deliberately before writing any code

Three levels were on the table: schema only; schema plus minimal CRUD;
or the full thing (schema, real authentication, and permission/
authority-limit enforcement wired into existing routes). The middle
option was chosen. This bundle creates real, validated, tested data —
it does not authenticate anyone, and nothing anywhere checks a
permission or an authority limit before letting an action through.
That remains a separate, later bundle.

## Where this data lives

`vf-app-poc`, not `vf-licence-poc` — a customer's own organisational
structure, people, and roles are customer *content*, the same trust
boundary as `rule_sets` and `invoice_runs`
(docs/decisions/0001-worker-split-and-tenant-resolution.md), not
cross-customer control-plane data.

## The six tables

- `org_units` — a customer's own org structure, optionally
  hierarchical (`parent_unit_id`, self-referencing).
- `org_users` — real individual people. Deliberately no credential,
  password, or session field — authentication is out of scope here.
  Includes a nullable `locale` column, unused by any code path yet,
  specifically so the day real per-user sessions exist, locale can
  come from the authenticated user rather than the whole deployment's
  `LOCALE` var (docs/decisions/0008-locale-aware-messages.md) without
  a further schema change.
- `org_roles` — customer-definable names, but every permission a role
  grants must come from a closed, code-defined vocabulary
  (`permissions.ts`), validated before insert — the same discipline
  the rule interpreter already applies to its own closed vocabulary.
- `org_user_roles` — many-to-many; a person can hold more than one
  role.
- `org_authority_limits` — per-user, per-currency approval ceilings,
  the real accounts-payable concept: "this person can approve up to X;
  above that, escalate." A composite key on `(user_id, currency)`, and
  an upsert on write, not insert-only — a limit revision (a promotion,
  a policy change) is a correction, not a new fact, the same precedent
  usage telemetry's idempotent upsert already established
  (docs/decisions/0004-usage-telemetry.md).
- `org_profiles` — which CIUS profile(s) a customer, or one of its
  units, actually issues/receives invoices under.

## CIUS profiles: verified before being hardcoded, not asserted from memory

Given this whole product exists for EN 16931/Peppol compliance, the
five profile identifiers in `cius_profile`'s `CHECK` constraint and
`profiles.ts`'s `CIUS_PROFILES` were confirmed against a live web
search before being written down, not assumed correct from training
data alone. Confirmed: "CIUS" (Core Invoice Usage Specification) is
the standards term; "BIS" (Business Interoperability Specification) is
Peppol's own branded synonym for the same thing — Peppol BIS Billing
3.0 *is* a CIUS of EN 16931, not a separate thing; and XRechnung
(Germany), Factur-X (France), and FatturaPA (Italy) are real, distinct
national CIUSes, confirmed by an independent source rather than
recalled.

The list is deliberately small and explicitly non-exhaustive — both
the migration's own comment and `profiles.ts`'s doc comment say so.
OpenPeppol and CEN publish updates to this space on their own release
cycle (a November 2025 Peppol BIS release was the most current
confirmed at the time of writing); extending this list later is a
normal, expected migration, not a sign anything here was wrong.

## Defense in depth, proven rather than assumed

Every CRUD handler validates against the closed permission and CIUS
profile vocabularies at the application layer *and* the schema itself
enforces the same thing via SQL `CHECK` constraints. Confirmed this is
genuine redundancy, not just a comment claiming it: the application-
layer check was deliberately disabled in both `handleCreateRole` and
`handleSetProfile`, and in both cases invalid data was still refused —
by the SQL `CHECK` constraint itself, at the storage layer, when the
application-layer guard was bypassed.

Every foreign-key-shaped standing invariant in the migration
(dangling `parent_unit_id`, dangling `unit_id` on a user or a profile,
a role assignment or authority limit referencing a user or role that
doesn't exist) was proven the same way: eight separate isolated
follow-up migrations, each deliberately introducing exactly the bad
data one invariant exists to catch, each correctly rejected — mostly
by the real FK constraint firing before the standing `ASSERT ALWAYS`
even gets a chance to run, which is itself the successful outcome.

## Deliberately not licence-gated

Unlike `/rules/compile` and `/rules/evaluate`, none of the six new
`/org/*` routes are blocked by a blocked licence. Managing a
customer's own organisational data (who your people are, what your
approval structure looks like) is administrative/setup activity, not
the product usage the licence actually gates — a blocked customer
should still be able to manage their own org data, the same way they
can still list worked examples or hit `/health`.

## What's still open

- No authentication anywhere in this subsystem — `org_users` rows
  exist, but nothing lets a real person log in as one yet.
- No enforcement — a role's `permissions_json` and a user's
  `org_authority_limits` are validated on write but checked by nothing
  on any existing route. Activating a rule, evaluating an invoice, and
  every `/org/*` write itself all remain open to anyone who can reach
  the API, exactly as they were before this bundle.
- `org_users.locale` is written and validated but read by nothing —
  the wiring described in `docs/decisions/0008-locale-aware-messages.md`
  ("once sessions exist, resolve locale from the user first, falling
  back to the deployment default") is not built here.
- No admin UI, matching every other precedent in this codebase — raw
  API only.
