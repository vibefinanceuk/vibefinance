-- 0069_purchase_order_status.sql
-- Decision 0377 — a real lifecycle for purchase orders, where
-- decision 0372 explicitly said none existed: "unlike Suppliers there
-- is no Change, no hold, no status." The operator's own follow-up
-- request reverses that, deliberately.
--
-- Three states, not five. Active/On-Hold/Closed are the real,
-- assignable lifecycle — set by hand (Hold/Release Hold/Close on the
-- pop-out, mirroring Suppliers' own hold mechanism) or overridden by
-- the next ERP load. Invoiced (Part)/Invoiced (Full), the other two
-- values the operator named, are not stored at all: they are derived
-- live, by comparing what real invoices reference this order against
-- its own payable amount (purchase-order-route.ts's own
-- effectiveStatusCase()), the same "computed, not stored, because a
-- purchase order can arrive after its invoice" reasoning decision
-- 0370 already established for po.matched itself.
ALTER TABLE purchase_orders ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'on_hold', 'closed'));

-- A hold needs a reason — the same requirement migration 0049 already
-- placed on a supplier's own hold, mirrored here rather than
-- reinvented. Nullable: only meaningful while status = 'on_hold'.
ALTER TABLE purchase_orders ADD COLUMN hold_reason TEXT;

-- Point-in-time: every existing order is Active, the only value that
-- existed before this migration by construction.
-- ASSERT: SELECT count(*) FROM purchase_orders WHERE status != 'active' == 0

-- Standing invariant: a hold reason exists only while actually on
-- hold — the same discipline suppliers.on_hold/hold_reason already
-- enforces, restated here rather than assumed to carry over.
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_orders WHERE status != 'on_hold' AND hold_reason IS NOT NULL == 0
