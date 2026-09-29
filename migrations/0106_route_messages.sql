-- 0106_route_messages.sql
-- Decision 0555 — Routes, slice 1: store first
-- (docs/design/routes-phase1-data-model.md, sections 3.5 to 3.9 and 5).
--
-- Every message that arrives on a Source is recorded here, and its
-- original (the whole email, and each attachment) is stored in R2 before
-- anything reads it. D1 holds only what the message is and what happened
-- to it. The bytes live only in R2, as invoice documents already do
-- (decision 0035). Nothing large is written to D1: no file, no rendering,
-- no extracted text.
--
-- **instance_id names a source for now.** Route instances arrive in slice
-- 3, and each existing source becomes an instance with the same id, so
-- these rows need no change then. route_id and route_version stay empty
-- until then too.

CREATE TABLE route_messages (
  id                TEXT PRIMARY KEY,
  instance_id       TEXT REFERENCES sources(id),
  route_id          TEXT,
  route_version     INTEGER,
  direction         TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  -- 'partial': some attachments became invoices and some did not.
  status            TEXT NOT NULL CHECK (status IN ('received', 'delivered', 'partial', 'failed', 'dismissed')),
  failed_part       TEXT CHECK (failed_part IN ('gateway', 'format', 'translation', 'delivery')),
  error_code        TEXT,
  error_text        TEXT,
  counterparty      TEXT,
  recipient         TEXT,
  subject           TEXT,
  bytes             INTEGER NOT NULL DEFAULT 0,
  received_at       TEXT NOT NULL,
  completed_at      TEXT,
  attempts          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_route_messages_instance ON route_messages(instance_id, received_at DESC);
CREATE INDEX idx_route_messages_status ON route_messages(status, received_at DESC);

-- The files, in R2. One row per object: the message as received
-- (role 'original') and each attachment read from it.
CREATE TABLE route_message_parts (
  message_id    TEXT NOT NULL REFERENCES route_messages(id),
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('original', 'attachment', 'translated', 'sent', 'reply')),
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  -- What became of an attachment: 'captured', 'failed', or 'skipped'
  -- (not a type an invoice arrives as). Null on the original.
  outcome       TEXT CHECK (outcome IN ('captured', 'failed', 'skipped')),
  reason        TEXT,
  stored_at     TEXT NOT NULL,
  PRIMARY KEY (message_id, seq)
);
CREATE INDEX idx_route_message_parts_sha ON route_message_parts(sha256);

-- What happened, in order: the monitor's history and its audit.
CREATE TABLE route_message_events (
  message_id  TEXT NOT NULL REFERENCES route_messages(id),
  seq         INTEGER NOT NULL,
  at          TEXT NOT NULL,
  event       TEXT NOT NULL,
  part_seq    INTEGER,
  detail      TEXT,
  actor       TEXT REFERENCES org_users(id),
  PRIMARY KEY (message_id, seq)
);

-- What a message made (in) or sent (out).
CREATE TABLE route_message_items (
  message_id  TEXT NOT NULL REFERENCES route_messages(id),
  item_type   TEXT NOT NULL CHECK (item_type IN ('invoice')),
  item_id     TEXT NOT NULL,
  part_seq    INTEGER,
  PRIMARY KEY (message_id, item_type, item_id)
);
CREATE INDEX idx_route_message_items_item ON route_message_items(item_type, item_id);

-- An invoice's original points at the message part it came from: the
-- same R2 object, not a second copy.
ALTER TABLE invoice_documents ADD COLUMN route_message_id TEXT REFERENCES route_messages(id);
ALTER TABLE invoice_documents ADD COLUMN part_seq INTEGER;

-- ASSERT: SELECT count(*) FROM route_messages == 0
-- A failed message says which part failed, and nothing else does.
-- ASSERT ALWAYS: SELECT count(*) FROM route_messages WHERE status = 'failed' AND failed_part IS NULL == 0
-- A document linked to a message names the part too.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_documents WHERE (route_message_id IS NULL) != (part_seq IS NULL) == 0
