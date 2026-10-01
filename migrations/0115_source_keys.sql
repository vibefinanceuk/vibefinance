-- 0115_source_keys.sql
-- Decision 0578 — HTTPS in. A Source instance of the HTTPS route gets its
-- own address and its own keys: each key names who sends with it (a
-- supplier's system, a portal), is shown once when made, kept only as its
-- hash, and can be revoked. Everything sent with it is a route message,
-- read as email is.

CREATE TABLE source_keys (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES sources(id),
  -- Who sends with it, which a supplier mapping may name (0561).
  name         TEXT NOT NULL,
  -- SHA-256 of the key, base64url, as user API keys are kept (0006).
  key_hash     TEXT NOT NULL UNIQUE,
  -- The first characters, so a person can tell keys apart.
  key_prefix   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES org_users(id),
  last_used_at TEXT,
  revoked_at   TEXT,
  revoked_by   TEXT REFERENCES org_users(id)
);
CREATE INDEX idx_source_keys_source ON source_keys(source_id);

-- ASSERT: SELECT count(*) FROM source_keys == 0
-- A revoked key says who revoked it.
-- ASSERT ALWAYS: SELECT count(*) FROM source_keys WHERE (revoked_at IS NULL) != (revoked_by IS NULL) == 0
