-- 0009_login_attempts.sql
-- Decision 0090 — recording sign-in attempts, and slowing down guessing.
--
-- **Why this lives in the control plane.** Authentication happens in
-- vf-licence: an instance never sees a password. Document 3's
-- constraint is that CONTROL_DB holds "customers, licences and
-- aggregate usage counts -- never customer content", and a failed
-- sign-in is not customer content. It is **authentication** data, which
-- belongs to the act of signing in and is this Worker's own job.
--
-- That draws the line in a way that generalises: vf-licence holds what
-- it needs to do its work, and never the customer's business data.
CREATE TABLE login_attempts (
  id             TEXT PRIMARY KEY,

  -- The email as typed, lowercased. Recorded even when no account
  -- exists for it, deliberately: an attempt against an address that was
  -- never a user is exactly the attempt most worth seeing.
  email          TEXT NOT NULL,

  -- Which environment was being signed in to. An attempt against
  -- Acme-production-eu must not slow down a sign-in to
  -- Acme-production-us -- separate instances, separate data, and
  -- decision 0086's tokens are scoped this way already.
  --
  -- Not a foreign key: an attempt naming an environment that does not
  -- exist is still an attempt, and refusing to record it would discard
  -- the probing most worth noticing.
  environment_id TEXT NOT NULL,

  succeeded      INTEGER NOT NULL CHECK (succeeded IN (0, 1)),

  -- ISO 27001:2022 Annex A 8.5 requires failed attempts to be noted
  -- "including for criminal and/or regulatory proceedings", so the
  -- source is recorded where the platform provides it.
  source_ip      TEXT,

  attempted_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The query this table exists to answer: attempts for one email at one
-- environment, most recent first.
CREATE INDEX idx_login_attempts_lookup ON login_attempts(email, environment_id, attempted_at);

-- The sweep's query: everything older than the retention period.
CREATE INDEX idx_login_attempts_age ON login_attempts(attempted_at);

-- Point-in-time: the table exists and is empty.
-- ASSERT: SELECT count(*) FROM login_attempts == 0

-- Standing invariant: succeeded stays boolean. The CHECK enforces it;
-- restated so a future change dropping the constraint is caught, since
-- a third value would silently break every count of failures.
-- ASSERT ALWAYS: SELECT count(*) FROM login_attempts WHERE succeeded NOT IN (0, 1) == 0

-- Standing invariant: an attempt always names an email and an
-- environment. A row missing either cannot be counted against anything,
-- and would sit in the table looking like evidence.
-- ASSERT ALWAYS: SELECT count(*) FROM login_attempts WHERE trim(email) = '' OR trim(environment_id) = '' == 0

-- Standing invariant: emails are stored lowercased. Otherwise
-- `Dan@acme.com` and `dan@acme.com` are different keys, and a delay
-- that counts one does not count the other -- which is a bypass, not an
-- inconsistency.
-- ASSERT ALWAYS: SELECT count(*) FROM login_attempts WHERE email != lower(email) == 0
