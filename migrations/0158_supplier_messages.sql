-- 0158_supplier_messages.sql — decision 0721.
--
-- The conversation between a customer and a supplier about one invoice,
-- through the supplier network (docs/design/supplier-portal.md, Phase 2).
-- Kept apart from document_comments on purpose: those are internal, and an
-- internal note must never reach a supplier by one wrong tick.
--
--   direction  to_supplier (from someone at the customer)
--              from_supplier (from a supplier's person, in the network)
--   kind       question (Ask supplier: the invoice waits on the answer)
--              message (anything else in the conversation)
--
-- A message from the customer has author_user_id; one from the supplier
-- has author_email, the portal login it came from. Who was emailed, and any
-- sending error, are kept with the message.

CREATE TABLE supplier_messages (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoice_headers(id),
  supplier_id    TEXT,
  direction      TEXT NOT NULL CHECK (direction IN ('to_supplier', 'from_supplier')),
  kind           TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('question', 'message')),
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
CREATE INDEX idx_supplier_messages_invoice ON supplier_messages(invoice_id, created_at);

-- ASSERT: SELECT count(*) FROM supplier_messages == 0
-- ASSERT ALWAYS: SELECT count(*) FROM supplier_messages WHERE (direction = 'to_supplier' AND author_user_id IS NULL) OR (direction = 'from_supplier' AND author_email IS NULL) == 0
