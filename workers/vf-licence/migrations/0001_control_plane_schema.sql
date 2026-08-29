-- 0001_control_plane_schema.sql
-- Blueprint, "Subsystem three": customers, licences, entitlements.
-- Deliberately its own chain, independent of migrations/ at the repo
-- root — this applies to vf-licence-poc, a completely different
-- database from vf-app-poc, via:
--   python3 migrations/apply_migrations.py --replay-only \
--     --migrations-dir workers/vf-licence/migrations
--   python3 migrations/apply_migrations.py --remote \
--     --database vf-licence-poc \
--     --migrations-dir workers/vf-licence/migrations
--
-- Same assertion syntax as migrations/0001_rule_engine_schema.sql —
-- see that file's header comment for the full explanation.

-- The Blueprint sketches customers and licences as one combined table
-- ("customers · licences"). Split here into two: identity fields
-- (slug, name, region, instance_url) rarely change once a customer is
-- provisioned; entitlement fields (plan, features, status) change on
-- every plan upgrade, downgrade, or billing event. Keeping them
-- separate means a plan change never touches the row that answers
-- "does this customer exist and where do they live" — a smaller,
-- more auditable blast radius for the far more frequent kind of edit.
CREATE TABLE customers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- Drives which D1 jurisdiction their database was created in — a
  -- decision that cannot be changed afterwards (Blueprint).
  region       TEXT NOT NULL,
  -- Where their Worker lives, including self-hosted (Blueprint).
  instance_url TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per customer — their *current* licence. Not append-only:
-- unlike rules or authority_limits, nothing in the Blueprint asks
-- "what was this customer's plan in March", so there is no standing
-- requirement to keep history here. If that requirement appears later,
-- versioning this table is a natural, additive migration — it does not
-- need to be guessed at now.
CREATE TABLE licences (
  customer_id          TEXT PRIMARY KEY REFERENCES customers(id),
  plan                 TEXT NOT NULL,
  -- JSON array of feature flag strings. Not yet a closed vocabulary —
  -- see shared/licensing/types.ts and docs/decisions/
  -- 0003-licensing-signed-token.md for why.
  features_json        TEXT NOT NULL DEFAULT '[]',
  -- Invoices per period. Reported against, never enforced mid-invoice
  -- (Blueprint) — nothing in this schema or the code that reads it
  -- counts down against this number in real time.
  volume_entitlement   INTEGER NOT NULL,
  valid_from           TEXT NOT NULL,
  valid_to             TEXT,
  -- The staged block, Blueprint: "notice in the product, then notice
  -- with a date, then restriction." Only 'blocked' actually restricts
  -- anything — see shared/licensing/token.ts's own comment on the
  -- same point.
  status               TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'warned', 'blocked')),
  status_reason        TEXT,
  status_effective_at  TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Point-in-time: the schema exists and is empty at the moment this
-- migration finishes.
-- ASSERT: SELECT count(*) FROM customers == 0

-- Standing invariant: every licence belongs to a customer that exists.
-- Enforced by the FK at insert time too; stated here as a fact the
-- runner re-checks on every replay, independent of whether a future
-- change ever drops the constraint.
-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE customer_id NOT IN (SELECT id FROM customers) == 0

-- Standing invariant: licences.status is always one the token-issuing
-- code and shared/licensing/token.ts's claims-shape check both
-- understand.
-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE status NOT IN ('active', 'warned', 'blocked') == 0
