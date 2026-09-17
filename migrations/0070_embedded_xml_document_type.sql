-- 0070_embedded_xml_document_type.sql
-- Decision 0383, phase 3 of docs/design/document-viewer.md.
--
-- Migration 0018's own comment named the three document cases and
-- said a Factur-X/ZUGFeRD hybrid needs "one 'original' row only,
-- since the received PDF/A-3 already embeds the XML — no separate
-- rendering needed." True of extraction, and it turned out to
-- undersell what a person actually wants to see: the embedded XML
-- is read once by pdf-attachment.ts and then thrown away, so a
-- hybrid invoice has no XML tab at all, unlike a bare-XML invoice
-- retaining the same kind of data.
--
-- 'embedded_xml' is a genuine third case, not a rendering of
-- anything — it is the authoritative data the PDF already carried,
-- retained on its own so it can be shown the way an 'original' XML
-- document already is. `original` keeps meaning exactly what
-- arrived (the outer PDF bytes, unchanged); `embedded_xml` is the
-- structured invoice that was inside it all along.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is
-- rebuilt — the same approach migration 0033 used to widen a status
-- column. Deliberately narrow: only document_type's CHECK changes,
-- every other column and every existing row carries across
-- unchanged. No index to drop and recreate first this time — 0018
-- never created one on this table.
CREATE TABLE invoice_documents_new (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoice_headers(id),
  r2_key        TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('original', 'generated_rendering', 'embedded_xml')),
  content_type  TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (invoice_id, document_type)
);

INSERT INTO invoice_documents_new
  SELECT id, invoice_id, r2_key, document_type, content_type, uploaded_at
  FROM invoice_documents;

DROP TABLE invoice_documents;
ALTER TABLE invoice_documents_new RENAME TO invoice_documents;

-- Point-in-time: nothing was lost in the rebuild, and nothing already
-- there was outside the set before this ran either.
-- ASSERT: SELECT count(*) FROM invoice_documents WHERE document_type NOT IN ('original', 'generated_rendering', 'embedded_xml') == 0

-- Standing invariant, widened. Restated because the rebuild replaced
-- the table that carried the previous one, and an invariant that
-- quietly stopped applying is worse than one that never existed.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_documents WHERE document_type NOT IN ('original', 'generated_rendering', 'embedded_xml') == 0

-- Standing invariant: at most one row per invoice per document type,
-- restated for the same reason — UNIQUE survives the rebuild above,
-- but a standing invariant says so rather than assuming a constraint
-- nobody re-asserted still holds.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT invoice_id, document_type, count(*) c FROM invoice_documents GROUP BY invoice_id, document_type HAVING c > 1) == 0

-- Standing invariant: an invoice never has an 'embedded_xml' row
-- without an 'original' row alongside it — the embedded XML is
-- retained *from* the outer PDF, never captured on its own with
-- nothing to have carried it.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_documents e WHERE e.document_type = 'embedded_xml' AND NOT EXISTS (SELECT 1 FROM invoice_documents o WHERE o.invoice_id = e.invoice_id AND o.document_type = 'original') == 0
