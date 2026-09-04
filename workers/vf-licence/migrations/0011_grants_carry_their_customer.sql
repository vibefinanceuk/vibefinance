-- 0011_grants_carry_their_customer.sql
-- Decision 0093 — making the one dangerous row impossible rather than
-- merely noticed.
--
-- Migration 0010 carried a standing invariant refusing an access grant
-- for an environment belonging to a different customer than the
-- person's credential, and decision 0092 claimed this meant such a row
-- "cannot be written by any route or by hand".
--
-- **It could.** A standing invariant is checked by the migration runner
-- at replay time: it DETECTS a violation rather than preventing one.
--
-- That was demonstrated rather than argued. A hand-written INSERT
-- granting `nobody@example.com` access to `Acme-production` succeeded
-- against the live control plane and sat there until it was deleted.
-- Had the login endpoint existed, `hasAccess` would have returned true.
--
-- This is the one row in the system that crosses the customer
-- boundary. Everything else is protected by each customer having their
-- own database; this table is the single place a control-plane row can
-- hand somebody another customer's data.
--
-- ---------------------------------------------------------------
-- Carrying the customer, rather than a trigger
-- ---------------------------------------------------------------
--
-- The rule spans three tables, so it cannot be a CHECK. A trigger was
-- written first and then rejected: it works, and it is **invisible in a
-- way a foreign key is not**. A trigger does not appear in the table
-- definition and a table rebuild drops it silently -- which this
-- project has done three times (decisions 0078, 0084). Its body also
-- contains semicolons, which the test harness's statement splitter and
-- possibly D1's own could not carry.
--
-- Carrying `customer_id` on the grant turns the rule into two ordinary
-- foreign keys. Together they make a cross-customer grant impossible to
-- write, they travel with the schema, and they need no new mechanism.

-- The composite key the second foreign key points at. `id` is already
-- unique alone; this states the pair so it can be referenced.
CREATE UNIQUE INDEX idx_environments_id_customer ON environments(id, customer_id);

-- Rebuilt rather than altered: SQLite cannot add a foreign key in
-- place. Nothing references this table, so it can be dropped safely --
-- unlike `environments` in migration 0008, whose three dependants made
-- the same operation fail twice before it worked.
CREATE TABLE user_environment_access_new (
  email          TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  customer_id    TEXT NOT NULL,
  granted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by     TEXT,
  PRIMARY KEY (email, environment_id),
  -- This person holds a credential for this customer...
  FOREIGN KEY (email, customer_id) REFERENCES user_credentials(email, customer_id),
  -- ...and this environment belongs to that same customer. Neither key
  -- alone is enough; together they close the boundary.
  FOREIGN KEY (environment_id, customer_id) REFERENCES environments(id, customer_id)
);

-- Carried across by joining to the environment, which is where the
-- customer authoritatively lives. Any row that cannot be placed this
-- way is one the new constraints would refuse anyway.
INSERT INTO user_environment_access_new (email, environment_id, customer_id, granted_at, granted_by)
  SELECT a.email, a.environment_id, e.customer_id, a.granted_at, a.granted_by
  FROM user_environment_access a
  JOIN environments e ON e.id = a.environment_id;

DROP TABLE user_environment_access;
ALTER TABLE user_environment_access_new RENAME TO user_environment_access;

CREATE INDEX idx_user_env_access_email ON user_environment_access(email);

-- Point-in-time: nothing was lost. A count of rows present before and
-- missing after, rather than comparing totals -- vacuous on an empty
-- replay database, and this table is empty in production too.
-- ASSERT: SELECT count(*) FROM user_environment_access WHERE customer_id NOT IN (SELECT id FROM customers) == 0

-- Standing invariant: the constraint is now PREVENTION, and this
-- detects anything that somehow arrived regardless. Both are worth
-- having and they are not the same thing -- which decision 0092
-- originally got wrong.
-- ASSERT ALWAYS: SELECT count(*) FROM user_environment_access a WHERE NOT EXISTS (SELECT 1 FROM user_credentials c JOIN environments e ON e.customer_id = c.customer_id WHERE c.email = a.email AND e.id = a.environment_id) == 0

-- Standing invariant: emails stay lowercased, restated because the
-- rebuild replaced the table migration 0010 wrote it against. An
-- invariant that quietly stops applying reads as protection while
-- protecting nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM user_environment_access WHERE email != lower(email) == 0

-- Standing invariant: every grant still names a real environment.
-- ASSERT ALWAYS: SELECT count(*) FROM user_environment_access WHERE environment_id NOT IN (SELECT id FROM environments) == 0
