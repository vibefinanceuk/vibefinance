-- 0112_supplier_mapping_misses.sql
-- Decision 0563 — supplier mappings: near misses, and retiring a mapping.
--
-- A supplier's own XML that no live mapping read now says why, where a
-- mapping on the route came close:
--   'not_for_sender' — a live mapping reads this root, but "Who it is for"
--                      does not include the sender;
--   'not_published'  — a mapping for this root and sender exists, but has
--                      never been published.
-- `mapping_id` then names that mapping, and `mapping_version` stays NULL:
-- it did not read the file. NULL where nothing came close, or where a
-- mapping did read (or tried to read) it.
ALTER TABLE route_message_parts ADD COLUMN mapping_miss TEXT
  CHECK (mapping_miss IS NULL OR mapping_miss IN ('not_for_sender', 'not_published'));

-- Retiring a mapping: who, and when. Its versions are kept as they were,
-- as history; a retired mapping reads nothing.
ALTER TABLE supplier_mappings ADD COLUMN retired_at TEXT;
ALTER TABLE supplier_mappings ADD COLUMN retired_by TEXT REFERENCES org_users(id);

-- ASSERT ALWAYS: SELECT count(*) FROM supplier_mappings WHERE status = 'retired' AND retired_at IS NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM route_message_parts WHERE mapping_miss IS NOT NULL AND (mapping_id IS NULL OR mapping_version IS NOT NULL) == 0
