-- 0009_process_instances_and_stage_visits.sql
-- Process instances and stage visits — the runtime machinery decision
-- 0018 explicitly deferred. See docs/decisions/0019-process-instances-
-- and-stage-visits.md. This is what actually moves a real subject
-- (an invoice, eventually anything else) through a process
-- definition's stages, evaluating each stage's rule set against
-- supplied facts and reacting to what fires — not a description of a
-- process, the running of one.

CREATE TABLE process_instances (
  id               TEXT PRIMARY KEY,
  process_id       TEXT NOT NULL REFERENCES processes(id),
  -- Subject-agnostic by design (decision 0015): the engine never
  -- knows or needs to know what an "invoice" or "expense report"
  -- structurally is, only that something with an id exists and rules
  -- can be evaluated against facts supplied about it.
  subject_type     TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  current_stage_id TEXT NOT NULL REFERENCES process_stages(id),
  status           TEXT NOT NULL DEFAULT 'in_progress',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_process_instances_subject ON process_instances(subject_type, subject_id);
CREATE INDEX idx_process_instances_stage ON process_instances(current_stage_id);

-- A stage visit is a rule-evaluation event against one process
-- instance's subject, at one specific stage — decision 0015's own
-- words. Deliberately a NEW, genuinely generic table, not a reuse of
-- invoice_runs: that table is literally invoice-shaped (an
-- invoice_id column), which would contradict the entire point of a
-- subject-agnostic engine. invoice_runs stays exactly as it is,
-- doing AP's own job; this is the workflow engine's equivalent.
CREATE TABLE stage_visits (
  id                  TEXT PRIMARY KEY,
  process_instance_id TEXT NOT NULL REFERENCES process_instances(id),
  stage_id            TEXT NOT NULL REFERENCES process_stages(id),
  -- 'automatic' for a stage with no rule_set_id at all (nothing to
  -- evaluate); otherwise the real interpreter outcome.
  outcome             TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stage_visits_instance ON stage_visits(process_instance_id);

CREATE TABLE stage_visit_steps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_visit_id TEXT NOT NULL REFERENCES stage_visits(id),
  seq            INTEGER NOT NULL,
  rule_id        TEXT NOT NULL,
  rule_version   INTEGER NOT NULL,
  matched        INTEGER NOT NULL
);

CREATE INDEX idx_stage_visit_steps_visit ON stage_visit_steps(stage_visit_id);

-- A task now optionally records which stage visit spawned it —
-- nullable, additive. Decision 0018's tasks predate real process
-- instances; a task created directly via that API (still valid, still
-- supported) has no stage visit to point to. A task spawned by a
-- fired assign_task action during a real visit does.
ALTER TABLE tasks ADD COLUMN stage_visit_id TEXT REFERENCES stage_visits(id);

CREATE INDEX idx_tasks_stage_visit ON tasks(stage_visit_id);

-- Point-in-time: all new tables are empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM process_instances == 0
-- ASSERT: SELECT count(*) FROM stage_visits == 0
-- ASSERT: SELECT count(*) FROM stage_visit_steps == 0

-- Standing invariant: a process instance's current_stage_id always
-- belongs to the same process_id it's an instance of — a stage from
-- a DIFFERENT process definition being set as "current" would be a
-- real, silent data-integrity bug, not something the FK alone catches
-- (the FK only confirms the stage exists somewhere, not that it
-- belongs to the right process).
-- ASSERT ALWAYS: SELECT count(*) FROM process_instances pi JOIN process_stages ps ON ps.id = pi.current_stage_id WHERE ps.process_id != pi.process_id == 0

-- Standing invariant: status is always one of the two states this
-- bundle actually implements — closed vocabulary discipline applied
-- to instance status the same way it's applied to rule fields,
-- operators, and actions.
-- ASSERT ALWAYS: SELECT count(*) FROM process_instances WHERE status NOT IN ('in_progress', 'completed') == 0

-- Standing invariant: a stage visit's stage always belongs to the
-- same process as the instance being visited — same class of bug as
-- the current_stage_id invariant above, checked at the visit-history
-- level too.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits sv JOIN process_instances pi ON pi.id = sv.process_instance_id JOIN process_stages ps ON ps.id = sv.stage_id WHERE ps.process_id != pi.process_id == 0
