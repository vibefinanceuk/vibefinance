-- 0126_sftp_routes.sql
-- Decision 0620 — the SFTP proof of concept. SFTP out, a Destination that
-- writes each invoice as a file into a folder on the customer's SFTP
-- server, and SFTP in (named since 0107, a draft until now), a Source that
-- collects files from a folder on someone else's server. Both run through
-- vf-sftp, a Worker with a container, by service binding.

INSERT INTO routes (id, direction, name, origin) VALUES ('sftp-out', 'destination', 'SFTP out', 'standard');
INSERT INTO route_versions (route_id, version, status, receiving_gateway, receiving_format, translation, delivery_format, delivery_gateway, published_at, note)
VALUES ('sftp-out', 1, 'live', 'process', 'en16931', 'vf_invoice_json_v1', 'en16931', 'sftp', datetime('now'), 'Decision 0620: SFTP out');

UPDATE route_versions SET status = 'live', published_at = datetime('now'), note = 'Decision 0620: SFTP in, collecting'
WHERE route_id = 'sftp-in' AND version = 1 AND status = 'draft';

-- ASSERT: SELECT count(*) FROM route_versions WHERE route_id = 'sftp-out' AND status = 'live' == 1
-- ASSERT: SELECT count(*) FROM route_versions WHERE route_id = 'sftp-in' AND status = 'live' == 1
