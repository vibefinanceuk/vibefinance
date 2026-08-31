-- 0006_org_teams.sql
-- Teams (see docs/decisions/0015-process-workflow-engine.md and
-- docs/decisions/0016-teams.md). A team is a group of org_users a
-- task can be assigned to, visible to and claimable by any member —
-- deliberately a separate concept from org_roles, not a reuse of it.
-- org_roles answers "is this person permitted to do this at all";
-- a team answers "whose queue does this land in." Two teams can hold
-- the exact same permission while working entirely separate queues.
--
-- This migration is schema plus the join table only — no task
-- assignment, no claiming, no eligibility checking. Those depend on
-- the tasks table (not yet built) and reuse enforce.ts's existing
-- hasPermission() once they exist, per decision 0015's own design.

CREATE TABLE org_teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: a person can belong to more than one team (a real AP
-- team and a real Expense team might well share members), and a team
-- obviously holds more than one person.
CREATE TABLE org_team_members (
  team_id TEXT NOT NULL REFERENCES org_teams(id),
  user_id TEXT NOT NULL REFERENCES org_users(id),
  PRIMARY KEY (team_id, user_id)
);

-- Point-in-time: both tables are empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM org_teams == 0
-- ASSERT: SELECT count(*) FROM org_team_members == 0

-- Standing invariant: every membership row references a real team and
-- a real user — same discipline as org_user_roles in
-- 0003_org_authority_profiles.sql.
-- ASSERT ALWAYS: SELECT count(*) FROM org_team_members WHERE team_id NOT IN (SELECT id FROM org_teams) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_team_members WHERE user_id NOT IN (SELECT id FROM org_users) == 0
