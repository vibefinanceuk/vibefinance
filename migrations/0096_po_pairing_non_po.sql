-- 0096_po_pairing_non_po.sql
-- Decision 0537 — a line on a PO invoice can be marked a **Non-PO line**
-- at Matching (freight, carriage, anything the order never covered). It
-- is then coded by hand like a Non-PO invoice's line, and left out of
-- PO line matching. A PO-matched line and a Non-PO coded line are
-- mutually exclusive, so the marker lives in the same row as a pairing:
-- one row per invoice line, either "this PO line" or "no PO line".
--
-- `kind` is 'po_line' (every existing row) or 'non_po'. A Non-PO row has
-- no PO line, so `po_line_number` must become nullable, which SQLite can
-- only do by rebuilding the table. Every row and column is carried over.
-- Still tied to the PO it was made against (`order_number`), exactly as
-- a pairing is: re-linking the invoice leaves it stored but inert.
CREATE TABLE invoice_line_po_pairings_new (
  invoice_id     TEXT NOT NULL REFERENCES invoice_headers(id),
  line_number    INTEGER NOT NULL,
  order_number   TEXT NOT NULL,
  po_line_number INTEGER,
  paired_by      TEXT NOT NULL REFERENCES org_users(id),
  paired_at      TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'suggestion')),
  kind           TEXT NOT NULL DEFAULT 'po_line' CHECK (kind IN ('po_line', 'non_po')),
  CHECK ((kind = 'non_po') = (po_line_number IS NULL)),
  PRIMARY KEY (invoice_id, line_number)
);

INSERT INTO invoice_line_po_pairings_new (invoice_id, line_number, order_number, po_line_number, paired_by, paired_at, source, kind)
  SELECT invoice_id, line_number, order_number, po_line_number, paired_by, paired_at, source, 'po_line' FROM invoice_line_po_pairings;

DROP TABLE invoice_line_po_pairings;
ALTER TABLE invoice_line_po_pairings_new RENAME TO invoice_line_po_pairings;

-- ASSERT: SELECT count(*) FROM invoice_line_po_pairings WHERE kind != 'po_line' == 0

-- A Non-PO line has no PO line; every other row has one.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_line_po_pairings WHERE (kind = 'non_po') != (po_line_number IS NULL) == 0
-- A Non-PO marker is always made by hand, never an accepted suggestion.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_line_po_pairings WHERE kind = 'non_po' AND source != 'manual' == 0
