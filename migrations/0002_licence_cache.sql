-- 0002_licence_cache.sql
-- The customer-side half of Blueprint "Subsystem three"'s signed-token
-- contract: a place to cache the last verified licence state, so
-- verification never needs a network call in the hot path (Blueprint:
-- "No network call in the hot path").
--
-- Singleton by construction (id CHECK (id = 1)) — one instance, one
-- customer, one current licence state. Not append-only: unlike
-- invoice_runs, there is no requirement anywhere in the Blueprint to
-- keep a history of past licence states, only the current one.

CREATE TABLE licence_cache (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  -- The verified LicenceClaims, as JSON. Stored as the already-verified
  -- claims, never the raw token — verification happens once, at fetch
  -- time (shared/licensing/token.ts, called from
  -- workers/vf-app/src/licence-cache.ts), not on every read of this row.
  claims_json TEXT NOT NULL,
  fetched_at  TEXT NOT NULL
);

-- Point-in-time: the schema exists and is empty at the moment this
-- migration finishes.
-- ASSERT: SELECT count(*) FROM licence_cache == 0

-- Standing invariant: there is never more than one cached licence
-- state. The CHECK (id = 1) constraint already guarantees this for any
-- single row, but stating it here too means the runner catches a
-- schema change that accidentally loosens that constraint later,
-- independent of whether the CHECK itself still exists.
-- ASSERT ALWAYS: SELECT count(*) FROM licence_cache <= 1
