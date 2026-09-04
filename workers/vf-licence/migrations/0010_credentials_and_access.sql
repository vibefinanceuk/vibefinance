-- 0010_credentials_and_access.sql
-- Decision 0092 — one password, and a row per instance you may reach.
--
-- The division, in the operator's own words: **vf-licence decides if
-- you get access; org_users decides what you get access to.** The same
-- authentication-versus-authorisation line decision 0083 drew, now with
-- a mechanism behind the first half rather than an assertion.
--
-- Why these live here at all: vf-licence has exactly one binding,
-- CONTROL_DB, and cannot reach a customer's org_users table (decision
-- 0091). The Worker that verifies a password must be able to see the
-- secret, and this is the only database it can see.

-- ---------------------------------------------------------------
-- The credential: one password per person, per customer.
-- ---------------------------------------------------------------
CREATE TABLE user_credentials (
  -- Lowercased, for the reason migration 0009 records: otherwise
  -- `Dan@acme.com` and `dan@acme.com` are different keys, and a
  -- lookup that misses is a bypass rather than an inconsistency.
  email         TEXT NOT NULL,

  -- Per CUSTOMER, not per environment. One password across a
  -- customer's EU and US instances -- a person should not hold two
  -- secrets for what is, to them, one organisation. Which instances
  -- they may reach is the separate grant below.
  customer_id   TEXT NOT NULL REFERENCES customers(id),

  -- Argon2id at OWASP parameters, encoded with its salt and cost so
  -- the cost can be raised later without invalidating it (decision
  -- 0089).
  password_hash TEXT NOT NULL,

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, customer_id)
);

-- ---------------------------------------------------------------
-- The grant: which instances this person may reach.
-- ---------------------------------------------------------------
--
-- **This is the mechanism decision 0083 section 5 needed.** That
-- decision said the environment selector "lists what you can reach, not
-- what the customer owns", and left it as an authorisation question
-- with nothing behind it. These rows are the answer, and the selector
-- can be built from one control-plane query without calling every
-- instance in turn.
CREATE TABLE user_environment_access (
  email          TEXT NOT NULL,
  environment_id TEXT NOT NULL REFERENCES environments(id),
  granted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- Who granted it. An access grant with nobody accountable for it is
  -- the kind of row that appears in an audit and cannot be explained.
  granted_by     TEXT,
  PRIMARY KEY (email, environment_id)
);

CREATE INDEX idx_user_env_access_email ON user_environment_access(email);
CREATE INDEX idx_user_credentials_customer ON user_credentials(customer_id);

-- Point-in-time: both tables exist and are empty.
-- ASSERT: SELECT count(*) FROM user_credentials == 0
-- ASSERT: SELECT count(*) FROM user_environment_access == 0

-- Standing invariant: every credential belongs to a real customer, and
-- every grant to a real environment. The FKs enforce it; restated to
-- match every other table here.
-- ASSERT ALWAYS: SELECT count(*) FROM user_credentials WHERE customer_id NOT IN (SELECT id FROM customers) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM user_environment_access WHERE environment_id NOT IN (SELECT id FROM environments) == 0

-- Standing invariant: emails are lowercased in both tables. Migration
-- 0009 records why -- a case-varied lookup that misses is a bypass.
-- ASSERT ALWAYS: SELECT count(*) FROM user_credentials WHERE email != lower(email) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM user_environment_access WHERE email != lower(email) == 0

-- Standing invariant: a password hash is never blank, and is always
-- Argon2id. A row storing something else -- a plain password, an empty
-- string, a hash from a scheme nobody remembers -- would authenticate
-- somebody or nobody, and both are worse than refusing to store it.
-- ASSERT ALWAYS: SELECT count(*) FROM user_credentials WHERE password_hash NOT LIKE 'argon2id$%' == 0

-- Standing invariant: a grant names an environment belonging to the
-- customer whose credential the person holds. Without this, a grant
-- could hand somebody an environment of a DIFFERENT customer -- one
-- row, and the isolation the whole design rests on is gone.
-- ASSERT ALWAYS: SELECT count(*) FROM user_environment_access a WHERE NOT EXISTS (SELECT 1 FROM user_credentials c JOIN environments e ON e.customer_id = c.customer_id WHERE c.email = a.email AND e.id = a.environment_id) == 0
