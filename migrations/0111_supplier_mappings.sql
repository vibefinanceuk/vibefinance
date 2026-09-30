-- 0111_supplier_mappings.sql
-- Decision 0561 — Routes phase 2, slice 2: supplier mappings.
--
-- A supplier who sends its own XML (a <Rechnung>, neither UBL nor CII) is
-- read through a mapping: which element becomes which EN 16931 Business
-- Term, and what function changes the value on the way. A mapping belongs
-- to a Source route, is recognised by the document's root element and,
-- optionally, who sent it, and is versioned: a draft is edited, and
-- publishing makes it the live version the route runs.

CREATE TABLE supplier_mappings (
  id          TEXT PRIMARY KEY,
  route_id    TEXT NOT NULL REFERENCES routes(id),
  name        TEXT NOT NULL,
  -- The document's root element, without its namespace prefix.
  root        TEXT NOT NULL,
  -- Who it is for: a JSON array of addresses or @domains. NULL is anyone.
  senders     TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES org_users(id)
);
CREATE INDEX idx_supplier_mappings_route ON supplier_mappings(route_id, root);

CREATE TABLE supplier_mapping_versions (
  mapping_id       TEXT NOT NULL REFERENCES supplier_mappings(id),
  version          INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('draft', 'live', 'retired')),
  -- {root, linesPath, lines: [{target, source, fx, say, origin}]}; see
  -- shared/ingestion/mapping-engine.ts.
  definition_json  TEXT NOT NULL,
  -- The kept message part it was drawn from, and is tried against.
  sample_message_id TEXT REFERENCES route_messages(id),
  sample_part_seq  INTEGER,
  created_at       TEXT NOT NULL,
  created_by       TEXT REFERENCES org_users(id),
  published_at     TEXT,
  published_by     TEXT REFERENCES org_users(id),
  PRIMARY KEY (mapping_id, version)
);
-- At most one live and one draft version of each mapping.
CREATE UNIQUE INDEX idx_supplier_mapping_live ON supplier_mapping_versions(mapping_id) WHERE status = 'live';
CREATE UNIQUE INDEX idx_supplier_mapping_draft ON supplier_mapping_versions(mapping_id) WHERE status = 'draft';

-- A message part read through a mapping says which, and which version; a
-- supplier's own XML that no mapping read keeps its root element, so the
-- monitor can offer to map it and publishing can find what it would fix.
ALTER TABLE route_message_parts ADD COLUMN mapping_id TEXT REFERENCES supplier_mappings(id);
ALTER TABLE route_message_parts ADD COLUMN mapping_version INTEGER;
ALTER TABLE route_message_parts ADD COLUMN xml_root TEXT;

-- ASSERT: SELECT count(*) FROM supplier_mappings == 0
-- A version belongs to a mapping that exists.
-- ASSERT ALWAYS: SELECT count(*) FROM supplier_mapping_versions v WHERE NOT EXISTS (SELECT 1 FROM supplier_mappings m WHERE m.id = v.mapping_id) == 0
-- A live version has been published by someone, at some time.
-- ASSERT ALWAYS: SELECT count(*) FROM supplier_mapping_versions WHERE status = 'live' AND published_at IS NULL == 0
-- A mapping is for a Source route.
-- ASSERT ALWAYS: SELECT count(*) FROM supplier_mappings m JOIN routes r ON r.id = m.route_id WHERE r.direction != 'source' == 0
