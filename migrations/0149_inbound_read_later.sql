-- 0149_inbound_read_later.sql — decision 0687.
--
-- An emailed message is accepted as soon as it is stored, and its
-- attachments are read afterwards, off the mail server's clock. Reading
-- five scanned PDFs took longer than the sender would wait, so the
-- sender treated the delivery as failed and sent the same email again
-- every five minutes, and each copy made the same invoices again.
--
--   email_message_id  the email's own Message-ID header (else the sha256
--                     of the raw message, prefixed "sha256:"): a second
--                     delivery of the same email is noted, never read.
--   read_queued_at    set when a message's attachments are left to be
--                     read later. Only these are picked up by the reader,
--                     so a message from before this change is never
--                     read again by surprise.
--   reading_until     a lease: while it lies in the future, one run is
--                     reading the message and no other may.
--   read_count        how many runs have claimed it. After three, what is
--                     still unread is failed with why, never retried for ever.

ALTER TABLE route_messages ADD COLUMN email_message_id TEXT;
ALTER TABLE route_messages ADD COLUMN read_queued_at TEXT;
ALTER TABLE route_messages ADD COLUMN reading_until TEXT;
ALTER TABLE route_messages ADD COLUMN read_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_route_messages_email_id ON route_messages(instance_id, email_message_id);
CREATE INDEX idx_route_messages_queued ON route_messages(status, read_queued_at);
