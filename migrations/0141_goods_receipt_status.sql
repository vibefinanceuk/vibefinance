-- 0141_goods_receipt_status.sql
-- Decision 0651 — Warehouse Receipts, slice 2: a receipt counts only
-- once it is registered, and a process can have a goods receipt as its
-- subject.
--
-- **pending, registered, rejected.** A receipt sent through the
-- Warehouse Receipts process is pending until the process completes;
-- then it is registered and counts. A person may reject a pending one,
-- with a reason, and it never counts. A receipt keyed on the screen is
-- registered at once, as before.
--
-- **Every receipt already on file is registered**, at the time it was
-- recorded: they all counted before this, and still do.

ALTER TABLE goods_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('pending', 'registered', 'rejected'));
ALTER TABLE goods_receipts ADD COLUMN registered_at TEXT;
ALTER TABLE goods_receipts ADD COLUMN rejected_at TEXT;
ALTER TABLE goods_receipts ADD COLUMN rejected_by TEXT REFERENCES org_users(id);
ALTER TABLE goods_receipts ADD COLUMN reject_reason TEXT;
UPDATE goods_receipts SET registered_at = created_at WHERE registered_at IS NULL;
CREATE INDEX idx_goods_receipts_status ON goods_receipts(status);

-- **What a process moves.** Every process so far is taken to move
-- invoices, except Supplier Maintenance (0350), which moves suppliers.
-- The Warehouse Receipts process moves goods receipts, and a process
-- that does takes no invoice sources, destinations or uploads. No list
-- of allowed values: the engine itself never needed one (0015), and
-- expense reports (0022) are moved by processes too.
ALTER TABLE processes ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'invoice';
UPDATE processes SET subject_type = 'supplier' WHERE id = 'supplier-maintenance';
