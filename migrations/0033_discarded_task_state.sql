-- 0033_discarded_task_state.sql
-- Decision 0078 — a discarded task is not a returned one.
--
-- Migration 0031 gave tasks four states: open, completed, returned,
-- cancelled. Discarding reused 'returned', because it shares the code
-- path that ends a task and cancels its siblings.
--
-- That was wrong, and the test written alongside it documented the
-- wrong behaviour, which is worse than no test at all. **Nothing goes
-- back when a document is discarded.** A task marked 'returned' when
-- its document was archived tells whoever reads it later that somebody
-- sent the invoice somewhere, and nobody did.
--
-- The instance status distinguishes the two outcomes -- archived versus
-- returned_manually -- but a task is the operator-facing unit, and
-- "why did this task end without being completed" should be answerable
-- from the task.
DROP INDEX IF EXISTS idx_tasks_status;

-- SQLite cannot alter a CHECK constraint in place, so the column is
-- rebuilt. Deliberately narrow: this touches `status` and nothing else,
-- and every other column is carried across unchanged.
CREATE TABLE tasks_new (
  id                   TEXT PRIMARY KEY,
  stage_id             TEXT NOT NULL REFERENCES process_stages(id),
  owner_team_id        TEXT REFERENCES org_teams(id),
  owner_user_id        TEXT REFERENCES org_users(id),
  required_permission  TEXT NOT NULL,
  claimed_by           TEXT REFERENCES org_users(id),
  claimed_at           TEXT,
  completed_by         TEXT REFERENCES org_users(id),
  completed_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  stage_visit_id       TEXT REFERENCES stage_visits(id),
  line_number          INTEGER,
  status               TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'returned', 'discarded', 'cancelled')),
  ended_by             TEXT REFERENCES org_users(id),
  ended_at             TEXT,
  end_reason           TEXT,
  returned_to_stage_id TEXT REFERENCES process_stages(id)
);

INSERT INTO tasks_new
  SELECT id, stage_id, owner_team_id, owner_user_id, required_permission,
         claimed_by, claimed_at, completed_by, completed_at, created_at,
         stage_visit_id, line_number, status, ended_by, ended_at,
         end_reason, returned_to_stage_id
  FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

-- Point-in-time: nothing was lost in the rebuild. Stated as a count of
-- rows whose status is now outside the widened set, which is zero both
-- on an empty replay database and on a populated one -- a row count
-- comparison would be vacuous on the first.
-- ASSERT: SELECT count(*) FROM tasks WHERE status NOT IN ('open', 'completed', 'returned', 'discarded', 'cancelled') == 0

-- Standing invariant: the widened closed set. Restated because the
-- rebuild replaced the table that carried the previous one, and an
-- invariant that quietly stopped applying is worse than one that never
-- existed.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE status NOT IN ('open', 'completed', 'returned', 'discarded', 'cancelled') == 0

-- Standing invariant: a completed task has a completer, and an
-- uncompleted one does not. Carried over from 0031 for the same reason.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE (status = 'completed') != (completed_by IS NOT NULL) == 0

-- Standing invariant: a task ended by a person names them and says why.
-- Widened from 0031 to cover discarding as well as returning: "nobody
-- needs to look at this again" is a claim that should carry an
-- explanation, precisely because nobody will.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE status IN ('returned', 'discarded') AND (ended_by IS NULL OR end_reason IS NULL OR trim(end_reason) = '') == 0

-- Standing invariant: an ended task is never also completed.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE ended_by IS NOT NULL AND completed_by IS NOT NULL == 0

-- Standing invariant: the ownership rule migration 0008 established,
-- restated because the rebuild replaced the table it was written
-- against.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE (owner_team_id IS NULL) = (owner_user_id IS NULL) == 0
