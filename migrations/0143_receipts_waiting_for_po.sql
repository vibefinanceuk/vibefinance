-- 0143_receipts_waiting_for_po.sql
-- Decision 0654 — Warehouse Receipts, slice 4: a receipt line waiting
-- for its purchase order.
--
-- **A line whose order is not loaded yet waits** (Dan agreed: no limit,
-- flagged after 7 days). `waiting_since` is when it started. Loading
-- the order checks it again. A waiting line never counts, even on a
-- registered receipt: Register may record the matched lines while one
-- waits (Dan agreed, question 4), and the waiting line counts once its
-- order is loaded and it matches.
ALTER TABLE goods_receipt_lines ADD COLUMN waiting_since TEXT;
CREATE INDEX idx_goods_receipt_lines_waiting ON goods_receipt_lines(order_number) WHERE waiting_since IS NOT NULL;

-- **Register asked for while lines wait**: Matching then lets the
-- receipt through with those lines held back.
ALTER TABLE goods_receipts ADD COLUMN register_partial INTEGER NOT NULL DEFAULT 0;
