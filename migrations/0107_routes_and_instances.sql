-- 0107_routes_and_instances.sql
-- Decision 0557 — Routes, slice 3: routes, their versions, and where each
-- is placed in a process (docs/design/routes-phase1-data-model.md,
-- sections 3.1 to 3.4 and 4).
--
-- A route is defined once, with its five parts in a version. An instance
-- places a route in a process: a Source at the process's entry stage, a
-- Destination at its exit stage. Every existing source becomes a Source
-- instance with the same id, so everything that names a source (route
-- messages, email events) keeps working unchanged.

CREATE TABLE routes (
  id           TEXT PRIMARY KEY,
  direction    TEXT NOT NULL CHECK (direction IN ('source', 'destination')),
  name         TEXT NOT NULL UNIQUE,
  origin       TEXT NOT NULL CHECK (origin IN ('standard', 'copied')),
  copied_from  TEXT REFERENCES routes(id),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT REFERENCES org_users(id)
);

-- The five parts, versioned. At most one live version per route.
CREATE TABLE route_versions (
  route_id           TEXT NOT NULL REFERENCES routes(id),
  version            INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('draft', 'live', 'superseded')),
  receiving_gateway  TEXT NOT NULL CHECK (receiving_gateway IN ('email', 'https', 'sftp', 'file_import', 'edi', 'peppol', 'process')),
  receiving_format   TEXT NOT NULL CHECK (receiving_format IN ('detected', 'ubl', 'cii', 'factur_x', 'supplier_xml', 'en16931', 'edifact')),
  translation        TEXT NOT NULL,
  delivery_format    TEXT NOT NULL CHECK (delivery_format IN ('en16931', 'ubl', 'csv', 'idoc')),
  delivery_gateway   TEXT NOT NULL CHECK (delivery_gateway IN ('process', 'file_download', 'https', 'sftp', 'peppol', 'email')),
  semantic_model     TEXT NOT NULL DEFAULT 'en16931',
  published_at       TEXT,
  published_by       TEXT REFERENCES org_users(id),
  note               TEXT,
  PRIMARY KEY (route_id, version)
);
CREATE UNIQUE INDEX idx_route_versions_one_live ON route_versions(route_id) WHERE status = 'live';

-- Where a route is placed. A Source instance IS a source: its name,
-- status, address and org stay on that row, and this one adds the route.
-- A Destination instance carries its own name and status.
CREATE TABLE route_instances (
  id          TEXT PRIMARY KEY,
  route_id    TEXT NOT NULL REFERENCES routes(id),
  process_id  TEXT NOT NULL REFERENCES processes(id),
  source_id   TEXT UNIQUE REFERENCES sources(id),
  name        TEXT,
  status      TEXT CHECK (status IN ('active', 'paused', 'retired')),
  settings_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT REFERENCES org_users(id)
);
CREATE INDEX idx_route_instances_process ON route_instances(process_id);

-- A process's way in and way out. On the process, not the stage, so a
-- process has at most one of each by construction (and a one-stage
-- process can be both).
ALTER TABLE processes ADD COLUMN entry_stage_id TEXT REFERENCES process_stages(id);
ALTER TABLE processes ADD COLUMN exit_stage_id TEXT REFERENCES process_stages(id);

-- The standard routes. Email and HTTPS are live, as they work today. SFTP,
-- file import and EDI are named as a source mechanism already (0060), but
-- nothing receives by them yet, so their versions are drafts.
INSERT INTO routes (id, direction, name, origin) VALUES
  ('email-in', 'source', 'Email in', 'standard'),
  ('https-in', 'source', 'HTTPS in', 'standard'),
  ('sftp-in', 'source', 'SFTP in', 'standard'),
  ('file-import', 'source', 'File import', 'standard'),
  ('edi-in', 'source', 'EDI in', 'standard'),
  ('erp-csv', 'destination', 'ERP CSV file', 'standard');

INSERT INTO route_versions (route_id, version, status, receiving_gateway, receiving_format, translation, delivery_format, delivery_gateway, published_at) VALUES
  ('email-in', 1, 'live', 'email', 'detected', 'standard_intake', 'en16931', 'process', datetime('now')),
  ('https-in', 1, 'live', 'https', 'detected', 'standard_intake', 'en16931', 'process', datetime('now')),
  ('sftp-in', 1, 'draft', 'sftp', 'detected', 'standard_intake', 'en16931', 'process', NULL),
  ('file-import', 1, 'draft', 'file_import', 'detected', 'standard_intake', 'en16931', 'process', NULL),
  ('edi-in', 1, 'draft', 'edi', 'edifact', 'standard_intake', 'en16931', 'process', NULL),
  ('erp-csv', 1, 'live', 'process', 'en16931', 'erp_csv_v1', 'csv', 'file_download', datetime('now'));

-- Each process's entry stage is the first stage of its current version,
-- and its exit stage the last: Intake and Payment Eligible in the
-- Standard AP Process, and the same stages 0552's payment-eligible
-- already takes as final.
UPDATE processes SET
  entry_stage_id = (SELECT v.stage_id FROM process_stage_versions v WHERE v.process_id = processes.id AND v.version = processes.version ORDER BY v.sequence ASC LIMIT 1),
  exit_stage_id = (SELECT v.stage_id FROM process_stage_versions v WHERE v.process_id = processes.id AND v.version = processes.version ORDER BY v.sequence DESC LIMIT 1);

-- Every source becomes a Source instance, with the same id.
INSERT INTO route_instances (id, route_id, process_id, source_id)
SELECT s.id,
       CASE s.mechanism WHEN 'email' THEN 'email-in' WHEN 'https' THEN 'https-in' WHEN 'sftp' THEN 'sftp-in' WHEN 'file_import' THEN 'file-import' ELSE 'edi-in' END,
       s.process_id, s.id
FROM sources s;

-- One ERP Destination for each process that receives invoices, reading
-- from its exit stage. The export itself is unchanged until slice 4.
INSERT INTO route_instances (id, route_id, process_id, name, status)
SELECT 'erp-' || p.id, 'erp-csv', p.id, 'ERP', 'active'
FROM processes p
WHERE EXISTS (SELECT 1 FROM sources s WHERE s.process_id = p.id);

-- ASSERT: SELECT count(*) FROM routes == 6
-- Every source is a Source instance.
-- ASSERT ALWAYS: SELECT count(*) FROM sources s WHERE NOT EXISTS (SELECT 1 FROM route_instances i WHERE i.source_id = s.id) == 0
-- A Source instance takes its name and status from its source, and a Destination instance has its own.
-- ASSERT ALWAYS: SELECT count(*) FROM route_instances WHERE (source_id IS NULL) != (name IS NOT NULL AND status IS NOT NULL) == 0
-- A Source instance places a source route, and a Destination instance a destination route.
-- ASSERT ALWAYS: SELECT count(*) FROM route_instances i JOIN routes r ON r.id = i.route_id WHERE (i.source_id IS NULL) != (r.direction = 'destination') == 0
-- A Source instance is in its source's own process.
-- ASSERT ALWAYS: SELECT count(*) FROM route_instances i JOIN sources s ON s.id = i.source_id WHERE i.process_id != s.process_id == 0
