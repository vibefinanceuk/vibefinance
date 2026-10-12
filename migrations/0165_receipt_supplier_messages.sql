-- 0165_receipt_supplier_messages.sql — decision 0740.
--
-- The conversation with a supplier about a goods receipt, in the same
-- store as an invoice's (0721): a message is about an invoice or about a
-- receipt, never both. The table is rebuilt so invoice_id may be empty;
-- nothing points to it. What a supplier's person has read of a receipt's
-- messages is kept beside what they have read of an invoice's (0728).

CREATE TABLE supplier_messages_new (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT REFERENCES invoice_headers(id),
  receipt_id     TEXT REFERENCES goods_receipts(id),
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
  created_at     TEXT NOT NULL,
  CHECK ((invoice_id IS NULL) <> (receipt_id IS NULL))
);
INSERT INTO supplier_messages_new (id, invoice_id, receipt_id, supplier_id, direction, kind, author_user_id, author_email, author_name, body, lines_json, stage_id, emailed_json, email_error, created_at)
  SELECT id, invoice_id, NULL, supplier_id, direction, kind, author_user_id, author_email, author_name, body, lines_json, stage_id, emailed_json, email_error, created_at FROM supplier_messages;
DROP INDEX IF EXISTS idx_supplier_messages_invoice;
DROP TABLE supplier_messages;
ALTER TABLE supplier_messages_new RENAME TO supplier_messages;
CREATE INDEX idx_supplier_messages_invoice ON supplier_messages(invoice_id, created_at);
CREATE INDEX idx_supplier_messages_receipt ON supplier_messages(receipt_id, created_at) WHERE receipt_id IS NOT NULL;

CREATE TABLE portal_receipt_reads (
  link_id    TEXT NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id),
  read_at    TEXT NOT NULL,
  PRIMARY KEY (link_id, receipt_id)
);

-- ASSERT ALWAYS: SELECT count(*) FROM supplier_messages WHERE (invoice_id IS NULL) = (receipt_id IS NULL) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM supplier_messages WHERE (direction = 'to_supplier' AND author_user_id IS NULL) OR (direction = 'from_supplier' AND author_email IS NULL) == 0
-- ASSERT: SELECT count(*) FROM portal_receipt_reads == 0
