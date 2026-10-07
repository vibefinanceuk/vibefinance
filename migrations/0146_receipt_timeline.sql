-- 0146_receipt_timeline.sql — decision 0658.
--
-- A goods receipt's Timeline and Chat, as the invoice viewer has
-- (0267/0470): what was decided and changed on it, a conversation, and
-- the people and teams AP adds to resolve a discrepancy with the
-- warehouse (Dan, 7 October 2026: "an opportunity for AP to add the
-- Warehouse team to the chat").
--
-- Receipt-specific tables rather than one generic subject table: each
-- keeps a real foreign key to goods_receipts, as invoice_collaborators
-- and document_comments keep theirs to invoice_headers.

-- What happened to a receipt that its own columns cannot say: a line
-- pointed at another order line, corrected, rejected or released by a
-- PO load, and people or teams added or removed. `kind` is an open list
-- (no CHECK), so a new kind needs no table rebuild; the code that writes
-- them is warehouse-receipts.ts and receipt-timeline.ts.
CREATE TABLE goods_receipt_events (
  id          TEXT PRIMARY KEY,
  receipt_id  TEXT NOT NULL REFERENCES goods_receipts(id),
  at          TEXT NOT NULL,
  actor_id    TEXT REFERENCES org_users(id),
  kind        TEXT NOT NULL,
  line_number INTEGER,
  detail_json TEXT
);
CREATE INDEX idx_goods_receipt_events_receipt ON goods_receipt_events(receipt_id, at);

-- The conversation.
CREATE TABLE goods_receipt_comments (
  id         TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id),
  author_id  TEXT NOT NULL REFERENCES org_users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_goods_receipt_comments_receipt ON goods_receipt_comments(receipt_id, created_at);

-- Who is in the conversation: a person or a whole team, never both.
-- Removing keeps the row (removed_at), so the Timeline can say who was
-- in it and when.
CREATE TABLE goods_receipt_collaborators (
  id         TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id),
  user_id    TEXT REFERENCES org_users(id),
  team_id    TEXT REFERENCES org_teams(id),
  added_by   TEXT NOT NULL REFERENCES org_users(id),
  added_at   TEXT NOT NULL,
  removed_by TEXT REFERENCES org_users(id),
  removed_at TEXT,
  CHECK ((user_id IS NULL) <> (team_id IS NULL))
);
CREATE UNIQUE INDEX idx_goods_receipt_collaborators_user ON goods_receipt_collaborators(receipt_id, user_id) WHERE removed_at IS NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_goods_receipt_collaborators_team ON goods_receipt_collaborators(receipt_id, team_id) WHERE removed_at IS NULL AND team_id IS NOT NULL;
CREATE INDEX idx_goods_receipt_collaborators_who ON goods_receipt_collaborators(user_id, team_id);

-- ASSERT ALWAYS: SELECT count(*) FROM goods_receipt_collaborators WHERE (user_id IS NULL) = (team_id IS NULL) == 0
-- ASSERT: SELECT count(*) FROM goods_receipt_events == 0
