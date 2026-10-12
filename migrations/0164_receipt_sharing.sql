-- 0164_receipt_sharing.sql — decision 0738.
--
-- Whether suppliers see the goods receipts recorded against their
-- purchase orders in the supplier network: AP Setup › Supplier Network
-- for every supplier, and a supplier's own setting, which wins.

CREATE TABLE network_sharing_config (
  id               TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  -- Goods receipts shared with suppliers: off until someone turns it on.
  share_receipts   INTEGER NOT NULL DEFAULT 0 CHECK (share_receipts IN (0, 1)),
  -- Only a registered receipt; one still being checked is not shown.
  registered_only  INTEGER NOT NULL DEFAULT 1 CHECK (registered_only IN (0, 1)),
  updated_by       TEXT,
  updated_at       TEXT
);
INSERT INTO network_sharing_config (id) VALUES ('default');

-- A supplier's own choice: 'share' or 'none'. No row: as AP Setup.
CREATE TABLE supplier_receipt_sharing (
  supplier_id  TEXT PRIMARY KEY REFERENCES suppliers(id),
  setting      TEXT NOT NULL CHECK (setting IN ('share', 'none')),
  updated_by   TEXT,
  updated_at   TEXT NOT NULL
);

-- ASSERT: SELECT count(*) FROM network_sharing_config WHERE share_receipts = 0 == 1
-- ASSERT: SELECT count(*) FROM supplier_receipt_sharing == 0
