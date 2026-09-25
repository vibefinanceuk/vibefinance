-- 0084_task_action_events_reassign.sql
-- Decision 0489 — Reassign: a person hands a task they hold directly
-- to a named colleague, rather than releasing it back to the pool and
-- waiting for someone to pick it up (or, for AP.TaskManage, doing the
-- same to a task somebody else holds, or one nobody has claimed yet).
--
-- **Widens `task_action_events` rather than adding a third table.**
-- Migration 0083's own comment already anticipated this: "widened
-- later (the same 'rebuild the table' pattern migration 0033 already
-- used to widen tasks.status) if a future action turns out to need it
-- too." Reassign is exactly that action — no other durable trace of
-- it exists anywhere (unlike return/return-to-supplier/discard, which
-- stay derived from `tasks` itself), so it belongs in the same table
-- claim/release already write to, not a fourth kind of new storage.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is
-- rebuilt — narrow, on purpose: only `action`'s own CHECK widens, and
-- one nullable column is added; `id`, `task_id`, `actor_id`, `at`, and
-- `comment` all carry across unchanged.
CREATE TABLE task_action_events_new (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id),
  action    TEXT NOT NULL CHECK (action IN ('claim', 'release', 'reassign')),
  actor_id  TEXT NOT NULL REFERENCES org_users(id),
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  comment   TEXT,

  -- **Who it was handed to** — the one fact a reassign carries that
  -- claim/release do not. Nullable because it is meaningless for the
  -- other two actions, the same shape `returned_to_stage_id` already
  -- takes on `tasks` for exactly one of its own several actions.
  target_user_id TEXT REFERENCES org_users(id)
);

INSERT INTO task_action_events_new (id, task_id, action, actor_id, at, comment)
  SELECT id, task_id, action, actor_id, at, comment FROM task_action_events;

DROP INDEX IF EXISTS idx_task_action_events_task;
DROP TABLE task_action_events;
ALTER TABLE task_action_events_new RENAME TO task_action_events;

CREATE INDEX idx_task_action_events_task ON task_action_events(task_id);

-- Point-in-time: nothing was lost in the rebuild, and reassign exists
-- in the widened set (vacuously true pre-population, real once a
-- reassign is ever recorded).
-- ASSERT: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign') == 0

-- Standing invariant: the widened closed set. Restated because the
-- rebuild replaced the table that carried the previous one.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign') == 0

-- Standing invariant: a reassign always names who it went to; neither
-- claim nor release ever does — there is nobody else to name.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE (action = 'reassign') != (target_user_id IS NOT NULL) == 0
