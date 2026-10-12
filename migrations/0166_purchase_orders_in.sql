-- 0166_purchase_orders_in.sql
-- Decision 0749 — purchase orders by Source Routes, slice 1.
--
-- **Three standard routes, delivering to the Purchase Orders process.**
-- Their versions carry the purchase order model (Peppol BIS Order Only 3,
-- delivered as UBL): every message, whatever it was sent as, is read into
-- the same order before it is checked.
--
-- - **Orders in**: HTTPS, with the source's own key: UBL Order, JSON or
--   our order CSV.
-- - **Orders by email**: a mailbox a procurement system sends its export
--   to, the order file attached.
-- - **Orders upload**: Purchase Orders' own load (CSV, or a UBL Order) is
--   one message of it, from the person.
INSERT INTO routes (id, direction, name, origin) VALUES
  ('orders-in', 'source', 'Orders in', 'standard'),
  ('orders-email', 'source', 'Orders by email', 'standard'),
  ('orders-file', 'source', 'Orders upload', 'standard');

INSERT INTO route_versions (route_id, version, status, receiving_gateway, receiving_format, translation, delivery_format, delivery_gateway, semantic_model, published_at) VALUES
  ('orders-in', 1, 'live', 'https', 'detected', 'purchase_order_v1', 'ubl', 'process', 'purchase_order', datetime('now')),
  ('orders-email', 1, 'live', 'email', 'detected', 'purchase_order_v1', 'ubl', 'process', 'purchase_order', datetime('now')),
  ('orders-file', 1, 'live', 'file_import', 'detected', 'purchase_order_v1', 'ubl', 'process', 'purchase_order', datetime('now'));

-- **An order on its way in.** Kept apart from `purchase_orders` until the
-- process releases it, so nothing matches, receipts or shares against an
-- order not yet released, and a change waiting here leaves the order in
-- force untouched. Released, it is written to `purchase_orders` as a load
-- always wrote it (replacing the order of that number), and names it.
CREATE TABLE purchase_order_intake (
  id                 TEXT PRIMARY KEY,
  order_number       TEXT NOT NULL,
  -- The order as read (the shared ParsedOrder), and the status column a
  -- load may carry (0377): what releasing writes.
  order_json         TEXT NOT NULL,
  status_json        TEXT,
  org_unit_id        TEXT REFERENCES org_units(id),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'rejected')),
  route_message_id   TEXT REFERENCES route_messages(id),
  -- Whether an order of this number was already in force when it arrived.
  is_change          INTEGER NOT NULL DEFAULT 0 CHECK (is_change IN (0, 1)),
  purchase_order_id  TEXT,
  created_by         TEXT REFERENCES org_users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  released_at        TEXT,
  rejected_at        TEXT,
  rejected_by        TEXT REFERENCES org_users(id),
  reject_reason      TEXT
);
CREATE INDEX idx_po_intake_message ON purchase_order_intake(route_message_id) WHERE route_message_id IS NOT NULL;
CREATE INDEX idx_po_intake_pending ON purchase_order_intake(order_number) WHERE status = 'pending';
