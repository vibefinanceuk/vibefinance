# 0011 — Fleet tooling: the manifest, and migrate-all

Status: settled, 30 August 2026. Blueprint build order step 5, the
last item on the numbered list that hadn't been started. Scoped
deliberately to the manifest plus `migrate-all` only — `deploy-all`
and "who's on what version" (code-version reporting specifically) are
real, separate pieces of work this bundle does not attempt, for
reasons recorded below.

## The manifest question, settled first

Every fleet tool needs to answer the same question first: which
customers exist, and where does each one's `vf-app` deployment
actually live? That answer didn't exist as data anywhere before this —
only implicitly, as whatever a single `wrangler.jsonc` happened to
contain at a given moment.

Extended `vf-licence`'s existing `customers` table rather than
introducing a separate fleet manifest file or a new table. `customers`
already tracked `instance_url` for exactly this class of reason — its
own migration's comment says so: "Where their Worker lives, including
self-hosted." A second, independent list of customers would only ever
be able to drift out of sync with this one; extending the table that
already exists avoids that failure mode by construction.

Four new nullable columns: `worker_name`, `d1_database_name`,
`d1_database_id`, `locale`. All backfilled at the application layer,
same pattern as `api_key_hash` before it — NULL means "not yet
configured," never a guessed default, and a fleet tool must treat a
customer with none of this set as not deployable yet.

## A real, currently-blocking gap, found while designing this

`vf-app`'s own `wrangler.jsonc` predicted the database-name field
explicitly in its own comment before this migration existed: "every
other customer's wrangler.jsonc differs only in `database_id` (and
eventually `database_name`)." Designing the manifest surfaced one more
field that comment didn't anticipate: the Worker's own `name` is
hardcoded `"vf-app"` today, and every Worker in one Cloudflare account
needs a unique name. A second customer's deployment cannot exist at
all under the current config without a distinct `worker_name` — this
was a real gap, not a hypothetical one, caught by designing the fleet
manifest before ever needing to onboard a second real customer.

## Two uniqueness invariants, proven, not assumed

`worker_name` and `d1_database_name` each have a standing invariant:
no two customers may share one. Cloudflare itself would refuse a
second deploy under a name already in use, but the invariant exists so
that failure is caught here, in data, before it ever reaches a live
`wrangler deploy` — the same "catch it before the platform does"
instinct behind every other assertion in this project's migrations.
Both were deliberately violated and confirmed to fail the replay
before being trusted.

## `GET /customers` and `PATCH /customers/:id/fleet-metadata`

Both admin-authenticated, for the same reason provisioning already is
— this is cross-customer administrative data, not something any single
customer's own credential should be able to read or change. `GET
/customers` never includes `api_key_hash` in its response — this is a
fleet manifest for `migrate-all` and future tools to read, not a
customer-detail endpoint, and there is no reason a hash needs to leave
this database at all, even hashed.

`PATCH .../fleet-metadata` is a true partial update: only fields
present in the request body change, everything else keeps its current
value. This is what lets Acme (the one real customer that predates
this migration) get backfilled with one call, and lets a future
redeploy — a customer's database gets recreated, say — be recorded
without needing to resend fields that haven't changed. Proven, not
just implemented: the "only provided fields change" behaviour was
deliberately broken (made every unset field clear to NULL instead of
being preserved) and confirmed to cause a real test failure.

## `migrate-all`

Built on top of `apply_migrations.py`, not a reimplementation of it —
the fleet tool's whole job is to loop over the manifest and shell out
to the same, already-proven migration runner once per customer, the
same way it's already been run by hand for Acme throughout this
project. `deploy-all` was deliberately not built in this bundle: it
needs either generating a per-customer `wrangler.jsonc` at deploy time
or maintaining one static file per customer, a genuinely separate
design question from the manifest itself, and a larger piece of work.

**Continue-on-error, deliberately.** One customer's migration failing
must never prevent the rest of the fleet from being attempted — every
customer is attempted regardless of what happened to any other, and
the script's own exit code (0 only if every attempted customer
succeeded) is what signals overall success, checked once at the end,
not used to short-circuit the loop. Proven, not just asserted: this
was deliberately broken (stop on first failure) and confirmed to cause
a real, specific test failure — a customer after a failed one being
skipped entirely.

A customer with no `d1_database_name` set is skipped, not failed —
the correct, expected state for a customer provisioned in `vf-licence`
but not yet deployed, not an error condition.

## What's tested, and what honestly isn't

Every piece of `migrate_all.py`'s own orchestration logic — parsing
the fleet manifest response, deciding what to skip, continuing past a
failure, building the summary, the exit code — is tested with the HTTP
call and the subprocess call both injected as fakes. What is **not**
tested, and cannot be from this development session: a real network
call to a live `vf-licence` deployment, and a real `wrangler d1
execute --remote` invocation. Both require Cloudflare credentials this
session does not have, the same limitation that has applied to every
`--remote` operation throughout this project — the operator runs this,
never the session, per `docs/change-and-promotion-model.md` §9.

## What's still open

- `deploy-all` — settled and built, see
  `docs/decisions/0012-deploy-all.md`.
- Code-version reporting ("who's on what version," the code half) —
  schema-version reporting is straightforward given the existing
  per-database migration bookkeeping table, but no deployed Worker
  currently reports which git commit it's actually running. Would need
  either a `/version` endpoint baked in at build time, or cross-
  referencing Cloudflare's own deployment API against commit history.
- No way to clear a fleet-metadata field back to NULL via the API —
  `PATCH .../fleet-metadata` can only set a field to a new non-empty
  string or leave it unchanged. A minor, real limitation, not built
  because nothing yet needs it.
- Acme's own real fleet metadata still needs backfilling via this
  bundle's new endpoint before `migrate-all` can do anything useful
  against live infrastructure.
