-- 0241_partner_connectors.sql
-- Decision 0595 — step 2 of slice 4: a partner submits a connector for review.
--
-- A connector is made from one Destination in the partner's sandbox
-- (`source_instance_id`), so submitting from it again makes its next
-- version. Each version waits for VibeFinance's review (step 3) before
-- any customer sees it (Dan, 1 October 2026). Its audience is every
-- customer linked to the partner (NULL) or the ones named.

CREATE TABLE partner_connectors (
  id                    TEXT PRIMARY KEY,
  partner_id            TEXT NOT NULL REFERENCES partners(id),
  source_environment_id TEXT NOT NULL REFERENCES environments(id),
  source_instance_id    TEXT NOT NULL,
  name                  TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  UNIQUE (source_environment_id, source_instance_id)
);
CREATE INDEX idx_partner_connectors_partner ON partner_connectors(partner_id);

CREATE TABLE partner_connector_versions (
  connector_id    TEXT NOT NULL REFERENCES partner_connectors(id),
  version         INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('submitted', 'approved', 'returned', 'withdrawn')),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  notes           TEXT,
  audience_json   TEXT,
  definition_json TEXT NOT NULL,
  submitted_by    TEXT NOT NULL,
  submitted_at    TEXT NOT NULL,
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  review_reason   TEXT,
  PRIMARY KEY (connector_id, version)
);
CREATE INDEX idx_partner_connector_versions_status ON partner_connector_versions(status);

-- ASSERT: SELECT count(*) FROM partner_connectors == 0
