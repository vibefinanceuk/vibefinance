-- 0140_goods_receipts.sql
-- Decision 0644 — Goods receipts, slice 2: the register. What arrived
-- and what went back, against purchase order lines.
--
-- **Lines point at the order number and line number, not at
-- `purchase_order_lines.id`.** A PO loaded again replaces its lines
-- with new ids (`purchase-order-route.ts`, 0370): that is how a change
-- order arrives, and receipts must survive it.
--
-- **Nothing is deleted.** A receipt entered by mistake is cancelled,
-- and stays with who cancelled it, when and why; its lines then count
-- for nothing.

CREATE TABLE goods_receipts (
  id             TEXT PRIMARY KEY,
  -- The warehouse's own receipt or return number. Unique: loading the
  -- same file again finds it rather than adding a second.
  receipt_number TEXT NOT NULL UNIQUE,
  -- When the goods arrived or went back (YYYY-MM-DD).
  receipt_date   TEXT NOT NULL,
  -- The supplier's despatch or delivery note, if given.
  delivery_note  TEXT,
  note           TEXT,
  source         TEXT NOT NULL CHECK (source IN ('csv', 'screen')),
  created_by     TEXT REFERENCES org_users(id),
  created_at     TEXT NOT NULL,
  cancelled_by   TEXT REFERENCES org_users(id),
  cancelled_at   TEXT,
  cancel_reason  TEXT,
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL))
);
CREATE INDEX idx_goods_receipts_date ON goods_receipts(receipt_date);

CREATE TABLE goods_receipt_lines (
  id                TEXT PRIMARY KEY,
  receipt_id        TEXT NOT NULL REFERENCES goods_receipts(id),
  -- The line within the receipt, so a reload is recognised.
  line_number       INTEGER NOT NULL,
  order_number      TEXT NOT NULL,
  order_line_number INTEGER NOT NULL,
  -- received: accepted into stock; returned: sent back, with a reason.
  movement          TEXT NOT NULL CHECK (movement IN ('received', 'returned')),
  quantity          REAL NOT NULL CHECK (quantity > 0),
  unit_code         TEXT,
  return_reason_id  TEXT REFERENCES goods_return_reasons(id),
  note              TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (receipt_id, line_number),
  CHECK ((movement = 'returned') = (return_reason_id IS NOT NULL))
);
CREATE INDEX idx_goods_receipt_lines_order ON goods_receipt_lines(order_number, order_line_number);

-- ASSERT: SELECT count(*) FROM goods_receipts == 0
-- ASSERT ALWAYS: SELECT count(*) FROM goods_receipt_lines WHERE quantity <= 0 == 0
