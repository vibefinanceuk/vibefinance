-- 0086_task_action_events_route_to_approver.sql
-- Decision 0497 — Route To Approver's own optional comment, asked for
-- directly: "add an optional comment box to the Route To Approver box,
-- similar to the Reassign box."
--
-- **Widens `task_action_events` again, the same way decision 0489
-- (migration 0084) already did for reassign** — not a new table, not
-- a new column beyond what reassign's own `target_user_id` already
-- added. Route To Approver posts to the ordinary `POST /tasks/:id/
-- complete` (decision 0495's own choice — there is no dedicated
-- action route), so completing normally stays completely untouched:
-- this event is written only when a `targetUserId` came with that
-- request, which happens only when the picker was actually used.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is
-- rebuilt again — narrow, on purpose: only `action`'s own CHECK
-- widens. No new column: `route_to_approver` reuses `target_user_id`
-- exactly the way `reassign` already does.
CREATE TABLE task_action_events_new (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id),
  action    TEXT NOT NULL CHECK (action IN ('claim', 'release', 'reassign', 'route_to_approver')),
  actor_id  TEXT NOT NULL REFERENCES org_users(id),
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  comment   TEXT,
  target_user_id TEXT REFERENCES org_users(id)
);

INSERT INTO task_action_events_new (id, task_id, action, actor_id, at, comment, target_user_id)
  SELECT id, task_id, action, actor_id, at, comment, target_user_id FROM task_action_events;

DROP INDEX IF EXISTS idx_task_action_events_task;
DROP TABLE task_action_events;
ALTER TABLE task_action_events_new RENAME TO task_action_events;

CREATE INDEX idx_task_action_events_task ON task_action_events(task_id);

-- Point-in-time: nothing was lost in the rebuild, and route_to_approver
-- exists in the widened set (vacuously true pre-population, real once
-- one is ever recorded).
-- ASSERT: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign', 'route_to_approver') == 0

-- Standing invariant: the widened closed set. Restated because the
-- rebuild replaced the table that carried the previous one.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign', 'route_to_approver') == 0

-- Standing invariant: a reassign or a route-to-approver always names
-- who it went to; neither claim nor release ever does — there is
-- nobody else to name. Widened from migration 0084's own single-action
-- version of this same invariant.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE (action IN ('reassign', 'route_to_approver')) != (target_user_id IS NOT NULL) == 0
