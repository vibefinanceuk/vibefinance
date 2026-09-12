-- 0059_document_comments.sql
--
-- **The only genuinely new storage the activity panel needs** —
-- decision 0267.
--
-- Everything system-generated in the panel — a document received, a
-- stage completed, a rule firing — already exists somewhere real:
-- invoice_headers, tasks, stage_visit_steps. Duplicating any of that
-- into a second table here would risk the exact drift decisions 0236
-- and 0264 already found and fixed once: a record that can quietly
-- disagree with the thing it claims to describe. A human comment has
-- no such source — it is new information, and this is where it lives.
CREATE TABLE document_comments (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoice_headers(id),
  author_id   TEXT NOT NULL REFERENCES org_users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_document_comments_invoice ON document_comments(invoice_id);

-- **Internal only, by construction, not by a flag someone could
-- toggle** — the operator's own words: "internal only for honest
-- dialogue between colleagues." There is no supplier-facing column,
-- no visibility switch; a customer-facing collaboration surface, if
-- built later, is a genuinely separate table and a separate decision,
-- not a bit flipped on this one.

-- ASSERT: SELECT count(*) FROM document_comments == 0
