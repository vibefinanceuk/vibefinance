-- 0032_org_settings_retention.sql
-- Decision 0077 — a configurable retention period.
--
-- Document 1 section 6.4 records long-term retention as a genuine
-- compliance question rather than an implementation detail, and
-- decision 0068 made it pressing by storing every captured document
-- rather than discarding it. Until now the answer was "forever" — a
-- decision by default rather than by choice.
--
-- This is a BENCHMARK, not a purge schedule. Nothing here deletes
-- anything. Storing a number is cheap and reversible; deleting on a
-- timer is neither, and a retention period is the kind of setting whose
-- first configuration is often wrong.
CREATE TABLE org_settings (
  -- A singleton. Each customer has their own database (Document 1
  -- section 5), so "the organisation" is the deployment, and a table
  -- with one row is more honest than a key-value store that pretends
  -- otherwise: these are typed columns with real constraints, not
  -- strings.
  id              INTEGER PRIMARY KEY CHECK (id = 1),

  -- How many years a document should be kept, counted from the anchor
  -- described below.
  --
  -- Default 7: the common EU and UK requirement for VAT records, and
  -- the same reasoning as the extraction settings of decision 0053 —
  -- a default asserts "this is usually true, and here is where to
  -- change it", where a hardcoded value asserts "this is always true"
  -- and cannot be inspected.
  --
  -- Bounded at 50 rather than left open. A retention period of 500
  -- years is a typo, not a policy, and the bound catches it at write
  -- time rather than in a report nobody reads.
  retention_years INTEGER NOT NULL DEFAULT 7 CHECK (retention_years BETWEEN 1 AND 50),

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The row exists from the start, so nothing has to handle its absence.
-- A settings table whose row may or may not be there means every reader
-- carries a fallback, and fallbacks drift from the defaults they
-- shadow.
INSERT INTO org_settings (id) VALUES (1);

-- Point-in-time: exactly one settings row, holding the default.
-- ASSERT: SELECT count(*) FROM org_settings == 1
-- ASSERT: SELECT retention_years FROM org_settings WHERE id = 1 == 7

-- Standing invariant: still exactly one row. The CHECK on the primary
-- key enforces it; restated because a second settings row would mean
-- two answers to a question that must have one, and whichever a reader
-- happened to get would look correct.
-- ASSERT ALWAYS: SELECT count(*) FROM org_settings == 1

-- Standing invariant: the period stays inside its bounds. Restated so a
-- future change that drops the CHECK is caught on the next replay.
-- ASSERT ALWAYS: SELECT count(*) FROM org_settings WHERE retention_years < 1 OR retention_years > 50 == 0
