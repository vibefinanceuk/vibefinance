-- 0123_outbound_mappings.sql
-- Decision 0591 — outbound mapping, slice 3 of the connector framework.
-- A Destination's own layout of each invoice, versioned like supplier
-- mappings (0561): at most one draft and one live version per Destination.
-- With none, a Destination sends the standard VibeFinance invoice JSON.

CREATE TABLE outbound_mapping_versions (
  instance_id TEXT NOT NULL REFERENCES route_instances(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'live', 'retired')),
  definition_json TEXT NOT NULL,
  copied_from TEXT,
  sample_invoice_id TEXT,
  saved_at TEXT NOT NULL,
  saved_by TEXT,
  published_at TEXT,
  published_by TEXT,
  PRIMARY KEY (instance_id, version)
);

CREATE INDEX idx_outbound_mapping_versions_status ON outbound_mapping_versions (instance_id, status);

-- ASSERT: SELECT count(*) FROM outbound_mapping_versions == 0
