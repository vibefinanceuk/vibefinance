-- 0022_pending_documents.sql
-- Multi-page invoice capture.
--
-- A real freight invoice runs to two pages, with the charge lines on
-- page one and the totals on page two. Submitting page one alone
-- produced a correct extraction of everything printed there and an
-- honest "no total stated" -- correct, and useless, because the
-- totals existed and were simply never seen.
--
-- This introduces something the system did not have: a document that
-- exists BEFORE it is an invoice. Pages accumulate against a pending
-- document, and extraction runs only when the operator says the
-- document is complete.
--
-- Why not invoice_documents (decision 0035): that table requires an
-- invoice_id referencing a row that must already exist, and its
-- UNIQUE (invoice_id, document_type) permits exactly one original per
-- invoice. Both are correct for a stored, extracted invoice and
-- neither can represent pages arriving before there is anything to
-- attach them to. Widening it would weaken guarantees that are right
-- for what it already does.
CREATE TABLE pending_documents (
  id           TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL REFERENCES intake_channels(id),
  -- 'open' while pages are still arriving; 'finalised' once
  -- extraction has run and an invoice exists. A finalised document is
  -- kept rather than deleted so the page set that produced a given
  -- invoice stays auditable.
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finalised')),
  -- Set on finalisation. NULL while open -- which is the whole point
  -- of this table, and why it cannot live in invoice_documents.
  invoice_id   TEXT REFERENCES invoice_headers(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finalised_at TEXT
);

CREATE TABLE pending_document_pages (
  id                  TEXT PRIMARY KEY,
  pending_document_id TEXT NOT NULL REFERENCES pending_documents(id),
  -- Explicit, caller-supplied, and NOT upload order. A retried or
  -- delayed page can easily arrive out of sequence, and page two's
  -- totals mean nothing to a model that reads them first.
  page_number         INTEGER NOT NULL,
  r2_key              TEXT NOT NULL,
  content_type        TEXT NOT NULL,
  uploaded_at         TEXT NOT NULL DEFAULT (datetime('now')),
  -- Re-uploading a page replaces it rather than duplicating it: a
  -- retry after a network failure must not produce two copies of
  -- page 1 that the model then reads twice.
  UNIQUE (pending_document_id, page_number)
);

CREATE INDEX idx_pending_pages_document ON pending_document_pages(pending_document_id);
CREATE INDEX idx_pending_documents_channel ON pending_documents(channel_id);

-- Point-in-time: both empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM pending_documents == 0
-- ASSERT: SELECT count(*) FROM pending_document_pages == 0

-- Standing invariant: status is closed to the two values the routes
-- understand.
-- ASSERT ALWAYS: SELECT count(*) FROM pending_documents WHERE status NOT IN ('open', 'finalised') == 0

-- Standing invariant: an open document has no invoice, and a
-- finalised one always has. This is the table's entire reason for
-- existing -- a document that exists before it is an invoice -- and
-- a row breaking it would mean either an invoice was created without
-- finalising, or finalisation ran and produced nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM pending_documents WHERE status = 'open' AND invoice_id IS NOT NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM pending_documents WHERE status = 'finalised' AND invoice_id IS NULL == 0

-- Standing invariant: finalised_at moves with the status, so "when
-- was this extracted" is answerable from the row itself.
-- ASSERT ALWAYS: SELECT count(*) FROM pending_documents WHERE (status = 'finalised') != (finalised_at IS NOT NULL) == 0

-- Standing invariant: page numbers are real, positive, and start at
-- one. A page 0 or a negative page would sort ahead of page 1 and
-- feed the model a document in the wrong order -- which is precisely
-- the failure explicit page numbers exist to prevent.
-- ASSERT ALWAYS: SELECT count(*) FROM pending_document_pages WHERE page_number < 1 == 0
