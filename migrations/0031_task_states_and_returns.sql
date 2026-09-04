-- 0031_task_states_and_returns.sql
-- Decision 0075 — returning a document.
--
-- Decision 0064 recorded that a task cannot complete negatively, and
-- that send-back therefore does not exist in any form. This is the
-- schema half of the answer.
--
-- A task has been open or completed, tested everywhere as
-- `completed_by IS NULL`. Returning needs two more states, and neither
-- is expressible by that test:
--
--   returned  — this person sent the document back. They did NOT do
--               the work, and recording completed_by would put a lie
--               in the audit trail.
--   cancelled — a sibling task, moot because the document left the
--               stage. Parallel approvers make this real: if one of
--               three returns the invoice, the other two cannot be
--               completed against a document that is no longer there.
--               Moot is not the same as abandoned, and the difference
--               should survive in the record.
ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'open'
  CHECK (status IN ('open', 'completed', 'returned', 'cancelled'));

-- Who ended the task, when it was not completed. Separate from
-- completed_by on purpose — see above.
ALTER TABLE tasks ADD COLUMN ended_by TEXT REFERENCES org_users(id);
ALTER TABLE tasks ADD COLUMN ended_at TEXT;

-- Why. Required by the application for a return, because a return with
-- no reason leaves the next person guessing. Free text rather than a
-- closed list: a coded reason would be better for reporting and worse
-- for the first hundred returns, when nobody yet knows what the
-- categories are (decision 0075 section 7).
ALTER TABLE tasks ADD COLUMN end_reason TEXT;

-- Backfill: every task completed before this migration is 'completed',
-- everything else is still open. The DEFAULT covers the second case;
-- this covers the first.
UPDATE tasks SET status = 'completed' WHERE completed_by IS NOT NULL;

-- Where a returned document was sent. NULL for a cancelled task and for
-- a return to supplier, which has no target stage.
ALTER TABLE tasks ADD COLUMN returned_to_stage_id TEXT REFERENCES process_stages(id);

-- The terminal states from decision 0055 section 5.4, for a document
-- returned to its supplier. The system sends nothing: a genuine return
-- path belongs to the source instance rather than the document, and an
-- SFTP drop may have only a filename. So this records that a person
-- took responsibility, and the contact happens outside.
ALTER TABLE process_instances ADD COLUMN ended_by TEXT REFERENCES org_users(id);
ALTER TABLE process_instances ADD COLUMN ended_at TEXT;
ALTER TABLE process_instances ADD COLUMN end_reason TEXT;

-- Note: migration 0009's standing invariant on process_instances.status
-- is widened in place to admit 'returned_manually' and 'archived' (the
-- terminal states of decision 0055 section 5.4). That edit needs
-- --refresh-checksums, which is the project's own way of saying an
-- applied migration was changed deliberately.
--
-- 'archived' is admitted now though nothing sets it yet: the invariant
-- describes the closed set the column may hold, and adding one state at
-- a time would mean editing 0009 twice for one design.

-- Point-in-time: the backfill left no task disagreeing with its own
-- completed_by. Stated as a count of disagreements rather than a total,
-- so it holds meaningfully on an empty replay database and a populated
-- one alike.
-- ASSERT: SELECT count(*) FROM tasks WHERE (completed_by IS NOT NULL AND status != 'completed') OR (completed_by IS NULL AND status = 'completed') == 0

-- Standing invariant: the status stays inside the closed set. The CHECK
-- enforces it at write time; restated so a future change that drops the
-- constraint is caught on the next replay rather than silently
-- permitting 'retruned'.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE status NOT IN ('open', 'completed', 'returned', 'cancelled') == 0

-- Standing invariant: a completed task has a completer, and an
-- uncompleted one does not. This is the invariant the whole state model
-- rests on -- if it drifts, `status` and `completed_by` start telling
-- different stories about the same task.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE (status = 'completed') != (completed_by IS NOT NULL) == 0

-- Standing invariant: a returned task names who returned it and why.
-- An anonymous return is a document that moved backwards with nobody
-- accountable and no explanation for the person receiving it.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE status = 'returned' AND (ended_by IS NULL OR end_reason IS NULL OR trim(end_reason) = '') == 0

-- Standing invariant: an ended task is never also completed. Belt and
-- braces over the CHECK, because these two columns are the ones a
-- future careless UPDATE would most plausibly set together.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE ended_by IS NOT NULL AND completed_by IS NOT NULL == 0
