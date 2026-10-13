-- 0170_order_timeline.sql — decision 0754.
--
-- A purchase order's Timeline and Chat, as a goods receipt's (0658): what
-- happened to the order and every change made to it, a conversation, and
-- the people and teams Purchasing adds to it. Dan, 13 October 2026: "The
-- Timeline / Chat should make note of PO changes, modifications, and
-- history".
--
-- Keyed by the order's number, as its conversation with the supplier is
-- (0752): an order's row is deleted and written again when a change or a
-- new load replaces it (0081), and its history stays.

-- What happened to an order that its own columns cannot say: each load or
-- change, with what it changed (header and lines, before and after);
-- Hold, Release hold and Close by hand; and people and teams added or
-- removed. `intake_id` names the order on its way in (0749) the change
-- came by, where it came by one. `kind` is an open list (no CHECK), as
-- goods_receipt_events'.
CREATE TABLE purchase_order_events (
  id           TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  at           TEXT NOT NULL,
  actor_id     TEXT REFERENCES org_users(id),
  kind         TEXT NOT NULL,
  intake_id    TEXT REFERENCES purchase_order_intake(id),
  detail_json  TEXT
);
CREATE INDEX idx_po_events_order ON purchase_order_events(order_number, at);
CREATE INDEX idx_po_events_intake ON purchase_order_events(intake_id) WHERE intake_id IS NOT NULL;

-- The conversation, among the people here.
CREATE TABLE purchase_order_comments (
  id           TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  author_id    TEXT NOT NULL REFERENCES org_users(id),
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_po_comments_order ON purchase_order_comments(order_number, created_at);

-- Who is in it: a person or a whole team, never both. Removing keeps the
-- row (removed_at), so the Timeline can say who was in it and when.
CREATE TABLE purchase_order_collaborators (
  id           TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  user_id      TEXT REFERENCES org_users(id),
  team_id      TEXT REFERENCES org_teams(id),
  added_by     TEXT NOT NULL REFERENCES org_users(id),
  added_at     TEXT NOT NULL,
  removed_by   TEXT REFERENCES org_users(id),
  removed_at   TEXT,
  CHECK ((user_id IS NULL) <> (team_id IS NULL))
);
CREATE UNIQUE INDEX idx_po_collaborators_user ON purchase_order_collaborators(order_number, user_id) WHERE removed_at IS NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_po_collaborators_team ON purchase_order_collaborators(order_number, team_id) WHERE removed_at IS NULL AND team_id IS NOT NULL;
CREATE INDEX idx_po_collaborators_who ON purchase_order_collaborators(user_id, team_id);

-- ASSERT ALWAYS: SELECT count(*) FROM purchase_order_collaborators WHERE (user_id IS NULL) = (team_id IS NULL) == 0
-- ASSERT: SELECT count(*) FROM purchase_order_comments == 0
