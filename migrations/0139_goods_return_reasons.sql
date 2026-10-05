-- 0139_goods_return_reasons.sql
-- Decision 0643 — Goods receipts, slice 1: why goods went back to a
-- supplier.
--
-- The same flat, customer-kept list as `supplier_return_reasons`
-- (0087), and kept apart from it: that list says why an *invoice* went
-- back, this one why *goods* did, and a report must never mix the two.
-- Every return recorded against a goods receipt (slice 2) names one.
--
-- **Deactivated, never deleted**, for the same reason as 0087: a
-- reason recorded on a past return must keep resolving.
CREATE TABLE goods_return_reasons (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seeded, as 0087 is, so returns can be recorded from the day this
-- ships. Ordinary rows: renamed, reordered or retired in AP setup.
INSERT INTO goods_return_reasons (id, label, sort_order) VALUES
  ('damaged',              'Damaged',                10),
  ('wrong_item',           'Wrong item',             20),
  ('not_ordered',          'Not ordered',            30),
  ('quality_failure',      'Quality failure',        40),
  ('short_dated',          'Short-dated or expired', 50),
  ('rejected_on_delivery', 'Rejected on delivery',   60);

-- ASSERT: SELECT count(*) FROM goods_return_reasons == 6
