-- 0125_partner_connector_copies.sql
-- Decision 0601. Partner connectors in the Route library (connector
-- framework slice 4, step 4). The control plane offers each partner
-- connector's latest approved version; this instance keeps a copy of each
-- version it has seen, so a Destination made from one never changes
-- without Upgrade, and keeps working when the connector is no longer
-- offered (suspended, or its partner unlinked).
--
-- id is the library id, partner:<connector id>, as in
-- route_instances.connector_id.

CREATE TABLE partner_connector_copies (
  id              TEXT NOT NULL,
  version         INTEGER NOT NULL,
  partner_id      TEXT NOT NULL,
  partner_name    TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  approved_at     TEXT,
  fetched_at      TEXT NOT NULL,
  -- 1 where this is the version the control plane offers now.
  offered         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, version)
);
