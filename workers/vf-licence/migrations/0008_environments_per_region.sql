-- 0008_environments_per_region.sql
-- Decision 0083 section 6 — one production per region, not one
-- production.
--
-- Migration 0005 introduced environments with:
--
--   UNIQUE (customer_id, kind)
--
-- and said so deliberately in its own words: "at most one sandbox and
-- one production per customer, never more, never a duplicate of
-- either." That was correct when `kind` was the only thing
-- distinguishing environments.
--
-- It is not a correction. It is a **change of intent**: a customer may
-- now hold `Morrison-EU` and `Morrison-US` productions, storing data in
-- each region while a single shared UI presents one at a time
-- (decision 0083 section 5). The old constraint refused exactly that.
--
-- The narrower guarantee survives WITHIN a region: a customer still
-- cannot have two productions in the EU. Only the axis widened.
DROP INDEX IF EXISTS idx_environments_customer;

-- SQLite cannot alter a UNIQUE constraint in place, so the table is
-- rebuilt. Deliberately narrow: only the constraint changes, and every
-- column is carried across unchanged.
CREATE TABLE environments_new (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  kind             TEXT NOT NULL CHECK (kind IN ('sandbox', 'production')),
  region           TEXT NOT NULL,
  instance_url     TEXT NOT NULL,
  worker_name      TEXT,
  d1_database_name TEXT,
  d1_database_id   TEXT,
  locale           TEXT,
  api_key_hash     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (customer_id, kind, region)
);

INSERT INTO environments_new
  SELECT id, customer_id, kind, region, instance_url, worker_name,
         d1_database_name, d1_database_id, locale, api_key_hash, created_at
  FROM environments;

DROP TABLE environments;
ALTER TABLE environments_new RENAME TO environments;

CREATE INDEX idx_environments_customer ON environments(customer_id);

-- Point-in-time: nothing was lost in the rebuild. Stated as a count of
-- rows now violating the widened rule, which is zero both on an empty
-- replay database and on a populated one — a row-count comparison would
-- be vacuous on the first.
-- ASSERT: SELECT count(*) FROM (SELECT customer_id, kind, region FROM environments GROUP BY customer_id, kind, region HAVING count(*) > 1) == 0

-- Standing invariant: one environment per customer, kind and region.
-- The narrower (customer_id, kind) invariant from migration 0005 is
-- superseded and edited there — restating a rule in two places with one
-- of them stale is how they come to disagree.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT customer_id, kind, region FROM environments GROUP BY customer_id, kind, region HAVING count(*) > 1) == 0

-- Standing invariants restated because the rebuild replaced the table
-- they were written against. An invariant that quietly stops applying
-- reads as protection while protecting nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE customer_id NOT IN (SELECT id FROM customers) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE kind NOT IN ('sandbox', 'production') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE api_key_hash = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE worker_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE d1_database_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE d1_database_id = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE locale = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT worker_name FROM environments WHERE worker_name IS NOT NULL GROUP BY worker_name HAVING count(*) > 1) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT d1_database_name FROM environments WHERE d1_database_name IS NOT NULL GROUP BY d1_database_name HAVING count(*) > 1) == 0

-- Standing invariant: a region is never blank. An environment whose
-- region is empty cannot be distinguished from another in the widened
-- constraint, which would silently restore the old behaviour.
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE trim(region) = '' == 0
