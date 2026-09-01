-- 0014_duplicate_detection.sql
-- Duplicate detection — see docs/decisions/0028-duplicate-detection.md.
-- Decision 0015 flagged this explicitly as blocked on per-line
-- evaluation (decision 0027, now built); this is what closes it.

-- BT-1 (Invoice number) had never been added to the closed vocabulary
-- at all until this decision — the single most natural anchor for
-- duplicate detection (the same supplier submitting the same invoice
-- number twice is, in the overwhelming majority of real cases, either
-- a genuine duplicate or an attempted double-billing), and no rule
-- could reference it before now.
ALTER TABLE invoice_headers ADD COLUMN invoice_number TEXT;

-- A weighted confidence score (0.0-1.0), not a boolean — computed and
-- stored whenever an invoice is upserted, comparing it against every
-- other invoice from the same supplier already on file. Exposed as
-- invoice.duplicate_confidence, a numeric derived field a customer's
-- own rule can compare against whatever threshold they choose
-- (`greater_than`, already in the closed vocabulary) — a
-- customer-configurable threshold needs no new mechanism at all, it's
-- just an ordinary rule condition.
ALTER TABLE invoice_headers ADD COLUMN duplicate_confidence REAL;

CREATE INDEX idx_invoice_headers_supplier_number ON invoice_headers(supplier_vat_id, invoice_number);

-- Standing invariant: a real confidence score is always in [0, 1] —
-- NULL (never scored, e.g. a legacy row from before this migration)
-- is a distinct, valid state from a computed 0.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_headers WHERE duplicate_confidence IS NOT NULL AND (duplicate_confidence < 0 OR duplicate_confidence > 1) == 0
