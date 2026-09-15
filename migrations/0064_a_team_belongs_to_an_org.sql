-- 0064_a_team_belongs_to_an_org.sql
-- Decision 0333 — reported live: "There should never be a null-org
-- team." Every team now belongs to exactly one org unit, required at
-- creation — unlike org_user_roles.unit_id, where null deliberately
-- means "held everywhere" (decision 0196). No such "everywhere team"
-- exists here; a delegated administrator's own view of teams is
-- scoped by this column the same way people already are (decision
-- 0321), and there is no unscoped case to reason about.
--
-- SQLite cannot add a NOT NULL column without a default to a table
-- that may already hold rows — recreated instead, the same pattern
-- migration 0047 already used for org_user_roles. Safe only because
-- org_teams is empty today; the assertion below fails loudly, rather
-- than guessing an org for a real team, if that is no longer true by
-- the time this runs.
-- ASSERT: SELECT count(*) FROM org_teams == 0

CREATE TABLE org_teams_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  unit_id    TEXT NOT NULL REFERENCES org_units(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The insert names only the old table's own columns — org_teams has
-- never had a unit_id, so nothing exists to carry forward; the
-- assertion above is what guarantees there is nothing to lose.
INSERT INTO org_teams_new (id, name, created_at)
  SELECT id, name, created_at FROM org_teams;

DROP TABLE org_teams;
ALTER TABLE org_teams_new RENAME TO org_teams;

-- Standing invariant: every team names a real org unit.
-- ASSERT ALWAYS: SELECT count(*) FROM org_teams WHERE unit_id NOT IN (SELECT id FROM org_units) == 0
