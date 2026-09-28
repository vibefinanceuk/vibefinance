-- 0095_po_pairing_source.sql
-- Decision 0536 — the invoice line table's Match column needs to tell a
-- line a person paired by hand apart from one where they accepted a
-- suggestion (decision 0534). Both were saved identically.
--
-- `source` is 'manual' (chosen in the picker) or 'suggestion' (Accept on
-- a scored suggestion). Every existing pairing was made in the picker or
-- by Accept before this column existed, and cannot now be told apart:
-- they become 'manual', the more conservative reading.
ALTER TABLE invoice_line_po_pairings ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'suggestion'));

-- ASSERT ALWAYS: SELECT count(*) FROM invoice_line_po_pairings WHERE source NOT IN ('manual', 'suggestion') == 0
