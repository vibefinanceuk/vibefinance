-- 0159_supplier_messages_return.sql — decision 0724.
--
-- Return to supplier shows in the supplier network: the return itself is
-- one more message to the supplier, kind 'return' (the reason, then the
-- comment for the supplier). 0158 listed the kinds in a CHECK, so the table
-- is rebuilt with the third. Nothing points to it.

CREATE TABLE supplier_messages_new (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoice_headers(id),
  supplier_id    TEXT,
  direction      TEXT NOT NULL CHECK (direction IN ('to_supplier', 'from_supplier')),
  kind           TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('question', 'message', 'return')),
  author_user_id TEXT REFERENCES org_users(id),
  author_email   TEXT,
  author_name    TEXT NOT NULL,
  body           TEXT NOT NULL,
  lines_json     TEXT,
  stage_id       TEXT,
  emailed_json   TEXT,
  email_error    TEXT,
  created_at     TEXT NOT NULL
);
INSERT INTO supplier_messages_new (id, invoice_id, supplier_id, direction, kind, author_user_id, author_email, author_name, body, lines_json, stage_id, emailed_json, email_error, created_at)
  SELECT id, invoice_id, supplier_id, direction, kind, author_user_id, author_email, author_name, body, lines_json, stage_id, emailed_json, email_error, created_at FROM supplier_messages;
DROP INDEX IF EXISTS idx_supplier_messages_invoice;
DROP TABLE supplier_messages;
ALTER TABLE supplier_messages_new RENAME TO supplier_messages;
CREATE INDEX idx_supplier_messages_invoice ON supplier_messages(invoice_id, created_at);

-- ASSERT ALWAYS: SELECT count(*) FROM supplier_messages WHERE (direction = 'to_supplier' AND author_user_id IS NULL) OR (direction = 'from_supplier' AND author_email IS NULL) == 0
