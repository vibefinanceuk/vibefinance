-- 0238_invitations.sql
-- Decision 0593 — inviting a person, in place of setting their password
-- by curl (Dan, 2 October 2026).
--
-- An invitation is for one email, at one customer, to some of its
-- environments. It is emailed as a link carrying a long random token and
-- a 6-digit code; the person enters the code and chooses a password, which
-- sets their credential and grants their access. Only hashes of the token
-- and the code are kept. It works once, expires, and is spent after five
-- wrong codes.

CREATE TABLE invitations (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL,
  customer_id          TEXT NOT NULL REFERENCES customers(id),
  environment_ids_json TEXT NOT NULL,
  token_hash           TEXT NOT NULL UNIQUE,
  code_hash            TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired', 'spent')),
  attempts             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  created_by           TEXT,
  -- 'operator', or 'environment:<id>' when a customer's own administrator invited them.
  created_via          TEXT NOT NULL,
  expires_at           TEXT NOT NULL,
  sent_at              TEXT,
  send_error           TEXT,
  accepted_at          TEXT
);
CREATE INDEX idx_invitations_customer_email ON invitations(customer_id, email);

-- ASSERT: SELECT count(*) FROM invitations == 0
