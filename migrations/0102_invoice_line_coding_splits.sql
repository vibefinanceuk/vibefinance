-- 0102_invoice_line_coding_splits.sql
-- Decision 0548 — split coding: one invoice line's cost shared across
-- several cost centres or projects, each with its own General Ledger
-- Code. The line's Commodity Code stays on the line: it describes what
-- was bought, not who pays for it.
--
-- A line with rows here is split, and its own BT-133, coding.project and
-- coding.gl_code are left blank; a line with none is coded as before.
-- `amount` is the net amount each split takes (the rows add up to the
-- line's BT-131); `share_pct` is what the person typed when splitting by
-- percentage, kept so the split reads back as they wrote it.
CREATE TABLE invoice_line_coding_splits (
  invoice_id  TEXT NOT NULL REFERENCES invoice_headers(id),
  line_number INTEGER NOT NULL,
  seq         INTEGER NOT NULL CHECK (seq >= 1),
  cost_centre TEXT,
  project     TEXT,
  gl_code     TEXT,
  share_pct   REAL CHECK (share_pct IS NULL OR (share_pct > 0 AND share_pct <= 100)),
  amount      REAL NOT NULL,
  PRIMARY KEY (invoice_id, line_number, seq)
);

CREATE INDEX idx_line_coding_splits_project ON invoice_line_coding_splits(project);

-- ASSERT: SELECT count(*) FROM invoice_line_coding_splits == 0
