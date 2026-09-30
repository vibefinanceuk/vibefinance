-- 0114_ap_upload.sql
-- Decision 0573 — Create → Upload documents. The standard File import
-- route, a draft since 0107, goes live as "AP upload": the AP team's own
-- way in, one invoice per file, read as email is. Every process that
-- receives invoices gets an AP upload source, and every role that
-- validates gets the new AP.Create permission.

UPDATE routes SET name = 'AP upload' WHERE id = 'file-import';

UPDATE route_versions
SET status = 'live', published_at = datetime('now'), note = 'Decision 0573: live for Create, Upload documents'
WHERE route_id = 'file-import' AND version = 1 AND status = 'draft';

-- One AP upload source per process that receives invoices and has none,
-- placing invoices in the same company as that process's first email
-- source, where it has one.
INSERT OR IGNORE INTO sources (id, process_id, name, mechanism, default_org_unit_id)
SELECT 'upload-' || p.id, p.id, 'AP upload', 'file_import',
       (SELECT s.default_org_unit_id FROM sources s
        WHERE s.process_id = p.id AND s.mechanism = 'email' AND s.status = 'active'
        ORDER BY s.created_at LIMIT 1)
FROM processes p
WHERE EXISTS (SELECT 1 FROM sources s WHERE s.process_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.process_id = p.id AND s.mechanism = 'file_import');

-- Each is a Source instance of the route, as every source is (0107).
INSERT INTO route_instances (id, route_id, process_id, source_id)
SELECT s.id, 'file-import', s.process_id, s.id
FROM sources s
WHERE s.mechanism = 'file_import'
  AND NOT EXISTS (SELECT 1 FROM route_instances i WHERE i.source_id = s.id);

UPDATE org_roles
SET permissions_json = json_insert(permissions_json, '$[#]', 'AP.Create')
WHERE permissions_json LIKE '%"AP.Validate"%' AND permissions_json NOT LIKE '%"AP.Create"%';

-- ASSERT: SELECT count(*) FROM route_versions WHERE route_id = 'file-import' AND status = 'live' == 1
-- ASSERT: SELECT count(*) FROM routes WHERE id = 'file-import' AND name = 'AP upload' == 1
-- Point-in-time: every role that validates can now create.
-- ASSERT: SELECT count(*) FROM org_roles WHERE permissions_json LIKE '%"AP.Validate"%' AND permissions_json NOT LIKE '%"AP.Create"%' == 0
-- Every source is a Source instance (0107's invariant, which this keeps).
-- ASSERT ALWAYS: SELECT count(*) FROM sources s WHERE NOT EXISTS (SELECT 1 FROM route_instances i WHERE i.source_id = s.id) == 0
