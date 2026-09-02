# 0036 — One customer, multiple environments

Status: settled, 2 September 2026. The foundational piece of the real,
described signup -> trial -> sandbox -> production flow: everything
else in that flow (a signup-request stage, an approval-triggered
provisioning orchestrator, trial licence semantics, a real
consumption-based billing model) sits on top of this schema, not the
other way round.

## The real flow this is building toward

A customer requests a 30-day free trial through a self-serve form.
Approval (a deliberate human checkpoint — "I want to know who is
asking before I permit") triggers automated provisioning of a real
environment. A 30-day licence gates configuration and testing access;
at expiry, the environment doesn't disappear — it becomes a permanent
sandbox, and the customer can separately request a real production
environment when ready. Pricing is planned as consumption-based, with
usage that must never blend sandbox testing activity into a real bill.

None of the signup/approval/provisioning/billing pieces are built
here — this decision is the data model they all depend on.

## The real, structural gap this closes

`customers` had exactly one `instance_url` column — a single-valued
field, not a one-to-many relationship. `licences.customer_id` was the
primary key itself — a genuine one-to-one. Neither could represent
"this customer has two real, separate deployments" at all, structurally,
regardless of what application code was written on top.

## What moved, and why every single field genuinely belongs where it went

`region`, `instance_url`, `worker_name`, `d1_database_name`,
`d1_database_id`, `locale`, and `api_key_hash` were all already,
individually, documented as per-deployment facts in the migrations
that originally added them (0001, 0003, 0004's own comments say so
directly) — this decision didn't invent that; it just took the
implication seriously. A sandbox and a production environment for the
same customer need their own, separate values for every one of them.
`customers` keeps only genuine identity: `id`, `name`, `created_at`.

A new `environments` table holds the rest, with `customer_id` as a
real foreign key and `UNIQUE(customer_id, kind)` enforcing exactly the
shape the described flow needs: at most one sandbox and one production
per customer, ever — not a soft convention, a real constraint.

`licences` and `usage_periods` were both re-keyed from `customer_id`
to `environment_id`. This is the concrete mechanism behind the two
properties the whole flow actually depends on: a sandbox's trial
licence and a production environment's real subscription are
genuinely separate entitlements, and — critically for a future
consumption-based bill — sandbox testing volume can never blend into
production's real usage figures. Proven directly, not just asserted:
a real test seeds heavy sandbox activity and light production
activity for the same customer and confirms production's own usage
row is unaffected.

## The migration itself, tested twice before being trusted

The obvious ordering — create `environments` while it still references
the original `customers`, migrate `licences`/`usage_periods`, then try
to drop `customers` — fails outright with a real `FOREIGN KEY`
constraint error. Confirmed directly, not assumed, using a Python
sqlite3 sandbox with `PRAGMA foreign_keys = ON`, matching D1's own
real enforcement. The fix: recreate `customers` first, have
`environments` reference it by name immediately, and only then drop
the original — also confirmed to correctly propagate through SQLite's
own `ALTER TABLE ... RENAME TO`, which updates `environments`' own FK
declaration to the final table name automatically.

That exact sequence was then run a second time using the real
migration file's own SQL body (not a hand-written approximation)
against a realistic Acme-shaped dataset — every real field (the D1
database id, the API key hash, real usage counts) confirmed to survive
correctly re-keyed to `acme-production`, foreign keys clean.

## A real, honest tooling limitation found and handled explicitly, not worked around silently

The migration runner re-checks every `ASSERT ALWAYS` from every prior
migration against the final schema, forever — by design, documented
directly in both the runner's own doc comment and `docs/change-and-
promotion-model.md` §6. Six standing invariants from 0001, 0002, 0003,
and 0004 referenced columns this migration genuinely moves away
(`licences.customer_id`, `usage_periods.customer_id`, and four
`customers` columns). Each was retired with an explicit comment
explaining why and pointing to its replacement — "an applied migration
is not edited without saying so" (§6) — rather than silently deleted
or worked around, and the equivalent, re-keyed invariant was added to
this migration in every case.

## A deliberate choice not to rename the signed token's own claim

`LicenceClaims.customerId` (`shared/licensing/types.ts`) is a real,
external contract `vf-app`'s own `licence-cache.ts` already consumes.
Renaming it was in scope for consideration, but deliberately declined
here: its value is now genuinely an environment id (e.g.
`"acme-production"`), not a bare customer id, and that's stated
plainly in `handleIssueToken`'s own comment and in the tests that
assert on it — rather than either silently leaving the mismatch
undocumented or expanding this bundle's blast radius into `shared`
and `vf-app`'s own consumption code for a rename that isn't load-
bearing for the schema change itself.

## What's still open

- The signup-request stage, the approval-triggered provisioning
  orchestrator, real trial-licence semantics, and the consumption-
  based billing model itself — this decision is the foundation they
  sit on, not any of them.
- Config migration from a sandbox into a real production environment,
  and possibly payment-info migration — both named explicitly as
  future work in the original conversation, not attempted here.
- Whether `LicenceClaims.customerId` should eventually be renamed to
  reflect what it actually now holds — deliberately deferred, not
  forgotten.
