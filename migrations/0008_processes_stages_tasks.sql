-- 0008_processes_stages_tasks.sql
-- Process definitions, stages, and tasks (see docs/decisions/
-- 0018-process-definitions-and-tasks.md, and the design in
-- docs/decisions/0015-process-workflow-engine.md). The definition and
-- ownership layer of the workflow engine — NOT the runtime machinery
-- that moves a real invoice through a process automatically. There is
-- deliberately no process_instances or stage_visits table here; tasks
-- are created directly for now, the same way compile and evaluate
-- were each provable independently before being wired together.

CREATE TABLE processes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE process_stages (
  id          TEXT PRIMARY KEY,
  process_id  TEXT NOT NULL REFERENCES processes(id),
  name        TEXT NOT NULL,
  -- Default order, not the only order. Sequence is what a stage
  -- advances to when nothing says otherwise; a rule's route_to action
  -- (redefined — see the decision doc — to mean "advance to stage",
  -- never "send to a team" as it once did in an earlier, unrelated
  -- test rule) is how a process deviates from it. A stage with no
  -- deviating rule simply advances to the next sequence number.
  sequence    INTEGER NOT NULL,
  -- Reuses the existing rule engine directly — one rule set per
  -- stage, not a parallel workflow-specific rules concept. NULL is a
  -- real, valid state: a stage with no rule set at all is purely
  -- automatic, matching decision 0015's own confirmed example (a
  -- two-line invoice, both lines under threshold, visiting Approval
  -- and auto-clearing with zero human tasks).
  rule_set_id TEXT REFERENCES rule_sets(id),
  UNIQUE (process_id, sequence)
);

CREATE INDEX idx_process_stages_process ON process_stages(process_id);

CREATE TABLE tasks (
  id                 TEXT PRIMARY KEY,
  stage_id           TEXT NOT NULL REFERENCES process_stages(id),
  -- Exactly one of the two — enforced below, not left to application
  -- code alone. Team-owned: any member holding required_permission
  -- may access it. Named-user-owned: only that person, though they
  -- still need required_permission — the check is universal
  -- regardless of assignment path (confirmed explicitly, "for now" —
  -- a real, revisitable decision, not treated as permanent).
  owner_team_id      TEXT REFERENCES org_teams(id),
  owner_user_id      TEXT REFERENCES org_users(id),
  -- A permission string from the closed permission vocabulary
  -- (permissions.ts) — supplied by the rule that created this task
  -- (assign_task's own params), not inferred from the stage or
  -- process. Validated against that closed list in application code,
  -- the same way a rule's own actions are validated against
  -- vocabulary.ts before being trusted.
  required_permission TEXT NOT NULL,
  -- A team-owned task starts unclaimed; a named-user task has no
  -- claiming step at all — it's already theirs. claimed_by is set
  -- exactly once, atomically, the same discipline already proven for
  -- rule-version activation's own ordering (decision 0014).
  claimed_by         TEXT REFERENCES org_users(id),
  claimed_at         TEXT,
  completed_by       TEXT REFERENCES org_users(id),
  completed_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_stage ON tasks(stage_id);
CREATE INDEX idx_tasks_owner_team ON tasks(owner_team_id);

-- Point-in-time: all three tables are empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM processes == 0
-- ASSERT: SELECT count(*) FROM process_stages == 0
-- ASSERT: SELECT count(*) FROM tasks == 0

-- Standing invariant: sequence numbers within one process are unique
-- — the UNIQUE constraint above already enforces this; restated so
-- the replay tool reports it directly.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT process_id, sequence FROM process_stages GROUP BY process_id, sequence HAVING count(*) > 1) == 0

-- Standing invariant: exactly one of owner_team_id / owner_user_id is
-- set, never both, never neither — a task with no owner at all can
-- never be accessed by anyone, and a task with both is ambiguous
-- about which access rule actually applies.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE (owner_team_id IS NULL) = (owner_user_id IS NULL) == 0

-- Standing invariant: a task can only be claimed once it's actually
-- team-owned — claiming a named-user task makes no sense, since it
-- was never unowned to begin with.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE claimed_by IS NOT NULL AND owner_team_id IS NULL == 0
