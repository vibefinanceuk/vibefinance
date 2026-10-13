-- 0169_order_supplier_messages.sql — decision 0752.
--
-- The conversation with a supplier about a purchase order, as an
-- invoice's (0721) and a goods receipt's (0740). Its own table, of the
-- same shape: `supplier_messages` holds a standing invariant that each of
-- its messages is about exactly one invoice or one receipt. Keyed by the
-- order's number, as receipts name orders (0644): an order's row is
-- rewritten when a change replaces it (0081), and the conversation stays.

CREATE TABLE purchase_order_messages (
  id             TEXT PRIMARY KEY,
  order_number   TEXT NOT NULL,
  supplier_id    TEXT,
  direction      TEXT NOT NULL CHECK (direction IN ('to_supplier', 'from_supplier')),
  kind           TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('question', 'message')),
  author_user_id TEXT REFERENCES org_users(id),
  author_email   TEXT,
  author_name    TEXT NOT NULL,
  body           TEXT NOT NULL,
  lines_json     TEXT,
  emailed_json   TEXT,
  email_error    TEXT,
  created_at     TEXT NOT NULL,
  CHECK ((direction = 'to_supplier' AND author_user_id IS NOT NULL) OR (direction = 'from_supplier' AND author_email IS NOT NULL))
);
CREATE INDEX idx_po_messages_order ON purchase_order_messages(order_number, created_at);

-- What a supplier's person has read of an order's messages (as 0728, 0740).
CREATE TABLE portal_order_reads (
  link_id      TEXT NOT NULL,
  order_number TEXT NOT NULL,
  read_at      TEXT NOT NULL,
  PRIMARY KEY (link_id, order_number)
);

-- What a person here has caught up on of an order's conversation with its
-- supplier, for Conversations on Tasks (as 0660, 0748).
CREATE TABLE purchase_order_reads (
  order_number TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES org_users(id),
  seen_at      TEXT NOT NULL,
  PRIMARY KEY (order_number, user_id)
);

-- ASSERT: SELECT count(*) FROM purchase_order_messages == 0
-- ASSERT: SELECT count(*) FROM portal_order_reads == 0
