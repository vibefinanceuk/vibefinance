-- 0168_order_sharing.sql — decision 0751.
--
-- Whether suppliers see the purchase orders placed with them, in the
-- supplier network: AP Setup › Supplier Network for every supplier, and a
-- supplier's own setting, which wins, as goods receipts (0738).

-- Purchase orders shared with suppliers: off until someone turns it on.
ALTER TABLE network_sharing_config ADD COLUMN share_orders INTEGER NOT NULL DEFAULT 0 CHECK (share_orders IN (0, 1));
-- Only orders issued on or after this date (YYYY-MM-DD); none: every order.
ALTER TABLE network_sharing_config ADD COLUMN orders_from TEXT;

-- A supplier's own choice: 'share' or 'none'. No row: as AP Setup.
CREATE TABLE supplier_order_sharing (
  supplier_id  TEXT PRIMARY KEY REFERENCES suppliers(id),
  setting      TEXT NOT NULL CHECK (setting IN ('share', 'none')),
  updated_by   TEXT,
  updated_at   TEXT NOT NULL
);

-- ASSERT: SELECT count(*) FROM network_sharing_config WHERE share_orders = 0 == 1
-- ASSERT: SELECT count(*) FROM supplier_order_sharing == 0
