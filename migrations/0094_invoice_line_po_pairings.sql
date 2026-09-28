-- 0094_invoice_line_po_pairings.sql
-- Decision 0532 — the PO matching panel, phase 2: a person pairs an
-- invoice line with a PO line by hand, and the pairing is kept so the
-- next match respects it.
--
-- **Its own table, never written over the supplier's BT-132.** BT-132
-- is what the supplier sent (and is hidden by default, decision 0164),
-- so a correction lives beside it. At evaluation a pairing is applied
-- as the line's order line reference (`po-pairings.ts`), so the
-- Matching rules, the invoice screen and the panel all read it.
--
-- **Tied to the PO it was made against.** `order_number` records which
-- PO the line was paired within; a pairing applies only while the
-- invoice's BT-13 still names that PO, so re-linking the invoice
-- (decision 0530) never carries a pairing across to an unrelated PO.
CREATE TABLE invoice_line_po_pairings (
  invoice_id     TEXT NOT NULL REFERENCES invoice_headers(id),
  line_number    INTEGER NOT NULL,
  order_number   TEXT NOT NULL,
  po_line_number INTEGER NOT NULL,
  paired_by      TEXT NOT NULL REFERENCES org_users(id),
  paired_at      TEXT NOT NULL,
  PRIMARY KEY (invoice_id, line_number)
);

-- Widen task_action_events again (0084, 0086, 0093) for `po_pair`.
-- `comment` carries "<invoice line>:<PO line>", the PO line empty when
-- a pairing was cleared.
CREATE TABLE task_action_events_new (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id),
  action    TEXT NOT NULL CHECK (action IN ('claim', 'release', 'reassign', 'route_to_approver', 'po_link', 'po_pair')),
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

-- ASSERT: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign', 'route_to_approver', 'po_link', 'po_pair') == 0

-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE action NOT IN ('claim', 'release', 'reassign', 'route_to_approver', 'po_link', 'po_pair') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE (action IN ('reassign', 'route_to_approver')) != (target_user_id IS NOT NULL) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE action = 'po_link' AND (comment IS NULL OR comment = '') == 0
-- A po_pair always names the invoice line it is about.
-- ASSERT ALWAYS: SELECT count(*) FROM task_action_events WHERE action = 'po_pair' AND (comment IS NULL OR comment NOT LIKE '%:%') == 0
-- A pairing is always to a real line number.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_line_po_pairings WHERE line_number < 1 OR po_line_number < 1 == 0
