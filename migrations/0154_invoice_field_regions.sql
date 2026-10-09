-- 0154_invoice_field_regions.sql — decision 0701.
--
-- Where each header value of an invoice is on its document: step 1 of
-- docs/design/supplier-layout-learning.md, agreed by Dan on 9 October 2026.
--
-- Recorded by the viewer when it finds a field's value on the page without
-- doubt (`found`), or when a person drags a box round a value and it goes into
-- the field (`lassoed`; `lassoed_corrected` when it replaced a different
-- value). The box is a fraction (0–1) of the unrotated page, as the viewer
-- draws it. `value` is what was there, so a region whose value was later
-- changed, or never saved, is not mistaken for evidence: it counts only while
-- it still matches the invoice's fact.
--
-- One row per invoice and field: the latest word on where it is.

CREATE TABLE invoice_field_regions (
  invoice_id   TEXT NOT NULL REFERENCES invoice_headers(id),
  field        TEXT NOT NULL,
  page_number  INTEGER NOT NULL CHECK (page_number >= 1),
  x            REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y            REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  w            REAL NOT NULL CHECK (w > 0 AND w <= 1),
  h            REAL NOT NULL CHECK (h > 0 AND h <= 1),
  -- The words printed beside it ("Gesamtbetrag"), lower case, no punctuation.
  label_text   TEXT,
  value        TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('found', 'lassoed', 'lassoed_corrected')),
  recorded_by  TEXT REFERENCES org_users(id),
  recorded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (invoice_id, field)
);

-- ASSERT: SELECT count(*) FROM invoice_field_regions == 0
