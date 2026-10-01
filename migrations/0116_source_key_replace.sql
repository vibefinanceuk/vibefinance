-- 0116_source_key_replace.sql
-- Decision 0581 — Replace an HTTPS key. A key cannot be shown again (only
-- its hash is kept), so a lost or leaked one is replaced: a new key with
-- the same name, which a supplier mapping's Who it is for names. The old
-- key says which key replaced it, and when it stops: 24 hours later,
-- unless it was stopped at once.

ALTER TABLE source_keys ADD COLUMN replaced_by TEXT REFERENCES source_keys(id);
ALTER TABLE source_keys ADD COLUMN expires_at TEXT;

-- ASSERT: SELECT count(*) FROM source_keys WHERE replaced_by IS NOT NULL OR expires_at IS NOT NULL == 0
-- A replaced key always says when it stops, and only a replaced key does.
-- ASSERT ALWAYS: SELECT count(*) FROM source_keys WHERE (replaced_by IS NULL) != (expires_at IS NULL) == 0
