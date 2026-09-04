-- 0005_customer_environments.sql
-- Decision 0036 — one customer, multiple environments (sandbox,
-- production), each with its own real D1/R2/Worker deployment and its
-- own real licence. Extends the control plane's own data model to
-- support the described signup -> trial -> sandbox -> production flow;
-- this migration is the schema piece only, the foundation everything
-- else in that flow sits on.
--
-- customers.instance_url/region/worker_name/d1_database_name/
-- d1_database_id/locale/api_key_hash were all genuinely per-deployment
-- facts already (0001, 0003, 0004's own comments say so directly) —
-- a sandbox and a production environment for the same customer would
-- each need their own, separate values for every one of them. Moved
-- to a new environments table; customers keeps only genuine identity
-- (id, name, created_at).
--
-- Tested directly before being trusted here: the exact ordering below
-- (recreate customers first, referencing it by name from environments
-- immediately, only then drop the original) was deliberately run
-- against a Python sqlite3 sandbox with a realistic Acme-shaped
-- dataset and PRAGMA foreign_keys = ON, matching D1's own real
-- enforcement (found and recorded in decision 0003's own commit
-- history). The naive ordering — creating environments while still
-- referencing the original customers table, then trying to drop it —
-- fails outright with a real FOREIGN KEY constraint error; this
-- migration would not replay clean with that ordering. SQLite's own
-- ALTER TABLE ... RENAME TO was also confirmed to correctly update
-- environments' own FK declaration to point at the final table name,
-- not the intermediate one — not assumed, checked directly.

-- Step 1: the new, slimmed customers table, populated first so
-- environments can reference it by name immediately, before the
-- original customers table is ever touched.
CREATE TABLE customers_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO customers_new (id, name, created_at) SELECT id, name, created_at FROM customers;

-- Step 2: environments — the real one-to-many relationship this
-- migration exists to introduce. UNIQUE(customer_id, kind) enforces
-- exactly the shape the described flow needs: at most one sandbox and
-- one production per customer, never more, never a duplicate of
-- either.
CREATE TABLE environments (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customers_new(id),
  kind             TEXT NOT NULL CHECK (kind IN ('sandbox', 'production')),
  region           TEXT NOT NULL,
  instance_url     TEXT NOT NULL,
  worker_name      TEXT,
  d1_database_name TEXT,
  d1_database_id   TEXT,
  locale           TEXT,
  api_key_hash     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (customer_id, kind)
);

-- Every existing customer's current, real deployment becomes their
-- 'production' environment — the honest characterization: Acme, the
-- one real customer that predates this migration, is already a real,
-- deployed customer, not a trial. id is deterministic
-- ({customer_id}-production), not random, so this migration replays
-- identically every time, matching the same discipline every other
-- migration in this project follows.
INSERT INTO environments (id, customer_id, kind, region, instance_url, worker_name, d1_database_name, d1_database_id, locale, api_key_hash)
  SELECT id || '-production', id, 'production', region, instance_url, worker_name, d1_database_name, d1_database_id, locale, api_key_hash
  FROM customers;

-- Step 3: licences and usage_periods, both re-keyed from customer_id
-- to environment_id. A licence is now a property of one specific
-- environment, not a customer as a whole — a sandbox's 30-day trial
-- licence and a production environment's real subscription are
-- genuinely separate entitlements. Usage likewise: sandbox testing
-- activity must never blend into the production usage figures a
-- future consumption-based bill would be computed from.
CREATE TABLE licences_new (
  environment_id      TEXT PRIMARY KEY REFERENCES environments(id),
  plan                TEXT NOT NULL,
  features_json        TEXT NOT NULL DEFAULT '[]',
  volume_entitlement   INTEGER NOT NULL,
  valid_from           TEXT NOT NULL,
  valid_to             TEXT,
  status               TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'warned', 'blocked')),
  status_reason        TEXT,
  status_effective_at  TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO licences_new (environment_id, plan, features_json, volume_entitlement, valid_from, valid_to, status, status_reason, status_effective_at, updated_at)
  SELECT e.id, l.plan, l.features_json, l.volume_entitlement, l.valid_from, l.valid_to, l.status, l.status_reason, l.status_effective_at, l.updated_at
  FROM licences l JOIN environments e ON e.customer_id = l.customer_id;

CREATE TABLE usage_periods_new (
  environment_id      TEXT NOT NULL REFERENCES environments(id),
  period_key           TEXT NOT NULL,
  invoices_processed   INTEGER NOT NULL DEFAULT 0,
  rules_evaluated       INTEGER NOT NULL DEFAULT 0,
  active_users          INTEGER,
  outcome_counts_json    TEXT NOT NULL DEFAULT '{}',
  received_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (environment_id, period_key)
);
INSERT INTO usage_periods_new (environment_id, period_key, invoices_processed, rules_evaluated, active_users, outcome_counts_json, received_at)
  SELECT e.id, u.period_key, u.invoices_processed, u.rules_evaluated, u.active_users, u.outcome_counts_json, u.received_at
  FROM usage_periods u JOIN environments e ON e.customer_id = u.customer_id;

-- Step 4: drop the originals, now that nothing references them, and
-- rename the replacements into their final names.
DROP TABLE licences;
ALTER TABLE licences_new RENAME TO licences;
DROP TABLE usage_periods;
ALTER TABLE usage_periods_new RENAME TO usage_periods;
DROP TABLE customers;
ALTER TABLE customers_new RENAME TO customers;

-- Standing invariant: every environment belongs to a real customer.
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE customer_id NOT IN (SELECT id FROM customers) == 0

-- Standing invariant: environments.kind is always one of the two real
-- values this whole design is built around.
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE kind NOT IN ('sandbox', 'production') == 0

-- Standing invariant: at most one sandbox and one production per
-- customer — restated so the replay tool reports it directly, the
-- same discipline applied to every other real CHECK/UNIQUE constraint
-- in this project, even though the schema's own UNIQUE already
-- enforces it unconditionally.
-- Superseded by migration 0008 (decision 0083 section 6): a customer
-- may now hold one production per REGION, so this rule widened to
-- (customer_id, kind, region). Edited in place rather than left
-- alongside the new one, because a standing invariant states what must
-- be true NOW -- and two rules over the same columns, one of them
-- stale, is how they come to disagree. Requires --refresh-checksums.
-- The narrower guarantee survives within a region; only the axis
-- widened.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT customer_id, kind, region FROM environments GROUP BY customer_id, kind, region HAVING count(*) > 1) == 0

-- Standing invariant: every licence belongs to a real environment —
-- the same shape as the original licences.customer_id invariant in
-- 0001, re-keyed.
-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE environment_id NOT IN (SELECT id FROM environments) == 0

-- Standing invariant: every usage report belongs to a real
-- environment — the same shape as 0002's own invariant, re-keyed.
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE environment_id NOT IN (SELECT id FROM environments) == 0

-- Standing invariant: licences.status is still always one the
-- token-issuing code and shared/licensing/token.ts's claims-shape
-- check both understand — unchanged from 0001, restated for the
-- recreated table.
-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE status NOT IN ('active', 'warned', 'blocked') == 0

-- Standing invariant: no negative usage counts — unchanged from 0002,
-- restated for the recreated table.
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE invoices_processed < 0 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE rules_evaluated < 0 == 0

-- Standing invariant: never an empty string for any of the moved
-- deployment-specific columns — the same "NULL means not yet
-- configured, empty string means a real bug in the write path"
-- distinction 0003/0004 already established, restated here now that
-- these columns live on environments.
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE api_key_hash = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE worker_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE d1_database_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE d1_database_id = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE locale = '' == 0

-- Standing invariant: worker_name and d1_database_name are each
-- unique among environments that have one set at all — two
-- environments cannot share a Worker or a database, the same
-- uniqueness 0004 already established for customers, restated here
-- now that these columns live on environments (and now meaningfully
-- stricter: a customer's own sandbox and production environments must
-- also never collide with each other, not just with another
-- customer's).
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT worker_name FROM environments WHERE worker_name IS NOT NULL GROUP BY worker_name HAVING count(*) > 1) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT d1_database_name FROM environments WHERE d1_database_name IS NOT NULL GROUP BY d1_database_name HAVING count(*) > 1) == 0
