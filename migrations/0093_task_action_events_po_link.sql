-- 0093_task_action_events_po_link.sql
-- Decision 0530 — the Matching stage's PO matching panel can re-link an
-- invoice to a different purchase order, and the operator's agreed
-- mock-up records that in the Timeline.
--
-- **Widens `task_action_events` again, the same way migrations 0084 and
-- 0086 did** for reassign and route_to_approver. `po_link` names no
-- person, so `target_user_id` stays NULL; `comment` carries the order
-- number linked to.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is
-- rebuilt — narrow, on purpose: only `action`'s own CHECK widens.
CREATE TABLE task_action_events_new (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id),
  action    TEXT NOT NULL CHECK (action IN ('claim', 'release', 'reassign', 'route_to_approver', 'po_link')),
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

-- Point-in-time: nothing was lost in the rebuild.
-- ASSERT: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign', 'route_to_approver', 'po_link') == 0

-- Standing invariant: the widened closed set.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign', 'route_to_approver', 'po_link') == 0

-- Standing invariant, unchanged from 0086: a reassign or a
-- route-to-approver always names who it went to; nothing else does.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE (action IN ('reassign', 'route_to_approver')) != (target_user_id IS NOT NULL) == 0

-- Standing invariant: a po_link always carries the order number.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE action = 'po_link' AND (comment IS NULL OR comment = '') == 0
