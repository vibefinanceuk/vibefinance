-- 0018_invoice_documents.sql
-- R2 document retention (decision 0013, decision 0035). D1 holds a
-- reference, not the document — the object's own bytes live only in
-- R2. A real, separate table rather than a column on invoice_headers
-- or invoice_runs (decision 0013's own original sketch), since a
-- single invoice can genuinely have more than one real stored
-- document: a pure UBL/XML invoice retains both the raw XML itself
-- (document_type 'original') and a generated human-readable rendering
-- (document_type 'generated_rendering') — see decision 0013's
-- addendum on the three document cases.
--
-- UNIQUE(invoice_id, document_type) enforces a real invariant: at
-- most one 'original' and one 'generated_rendering' per invoice,
-- matching all three of decision 0013's document cases exactly — a
-- native document (one 'original' row), a pure XML/UBL document (an
-- 'original' XML row plus a 'generated_rendering' PDF row), and a
-- Factur-X hybrid (one 'original' row only, since the received
-- PDF/A-3 already embeds the XML — no separate rendering needed).
CREATE TABLE invoice_documents (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoice_headers(id),
  r2_key        TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('original', 'generated_rendering')),
  content_type  TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (invoice_id, document_type)
);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM invoice_documents == 0
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_documents WHERE document_type NOT IN ('original', 'generated_rendering') == 0
