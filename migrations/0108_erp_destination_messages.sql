-- 0108_erp_destination_messages.sql
-- Decision 0558 — Routes, slice 4: the ERP export as a Destination
-- (docs/design/routes-phase1-data-model.md, sections 3.5, 3.8 and 4.5).
--
-- An outbound message names the Destination instance it went out on.
-- route_messages.instance_id names a source (0106), and a Destination
-- instance is not one, so outbound messages get their own column rather
-- than a rebuilt table: every row keeps its id, and the tables that
-- reference route_messages are untouched.
--
-- Each ERP export is an outbound message: delivered when made, and
-- dismissed (failed at delivery, with the reason) when undone, which
-- closes it rather than leaving it counted as a failure still to fix.

ALTER TABLE route_messages ADD COLUMN destination_id TEXT REFERENCES route_instances(id);
ALTER TABLE route_messages ADD COLUMN erp_export_id TEXT REFERENCES erp_exports(id);
CREATE INDEX idx_route_messages_destination ON route_messages(destination_id, received_at DESC);
CREATE INDEX idx_route_messages_erp_export ON route_messages(erp_export_id);

-- Every process that has had an invoice exported has an ERP Destination
-- (0107 gave one to every process with a source, and this covers the rest).
INSERT INTO route_instances (id, route_id, process_id, name, status)
SELECT DISTINCT 'erp-' || pi.process_id, 'erp-csv', pi.process_id, 'ERP', 'active'
FROM erp_export_rows er
JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = er.invoice_id
WHERE NOT EXISTS (SELECT 1 FROM route_instances i WHERE i.id = 'erp-' || pi.process_id);

-- Exports made before this: one message each, on the ERP Destination of
-- the process of the export's first invoice. Their file stays where it
-- always was, rebuilt from the rows on the ERP export screen, so these
-- messages have no stored part.
INSERT INTO route_messages
  (id, instance_id, destination_id, erp_export_id, direction, status, failed_part, error_code, error_text,
   recipient, subject, bytes, received_at, completed_at)
SELECT
  'MSG-' || upper(substr(replace(x.id, '-', ''), 1, 4)) || '-' || upper(substr(replace(x.id, '-', ''), 5, 4)) || '-' || upper(substr(replace(x.id, '-', ''), 9, 4)),
  NULL,
  (SELECT 'erp-' || pi.process_id FROM erp_export_rows er
     JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = er.invoice_id
     WHERE er.export_id = x.id ORDER BY er.seq LIMIT 1),
  x.id,
  'out',
  CASE WHEN x.reversed_at IS NULL THEN 'delivered' ELSE 'dismissed' END,
  CASE WHEN x.reversed_at IS NULL THEN NULL ELSE 'delivery' END,
  CASE WHEN x.reversed_at IS NULL THEN NULL ELSE 'undone' END,
  x.reverse_reason,
  'ERP',
  CASE WHEN x.invoice_count = 1 THEN 'Export of 1 invoice' ELSE 'Export of ' || x.invoice_count || ' invoices' END,
  0,
  replace(x.created_at, ' ', 'T') || 'Z',
  replace(x.created_at, ' ', 'T') || 'Z'
FROM erp_exports x
WHERE EXISTS (SELECT 1 FROM erp_export_rows er
                JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = er.invoice_id
                WHERE er.export_id = x.id);

INSERT INTO route_message_items (message_id, item_type, item_id)
SELECT DISTINCT m.id, 'invoice', er.invoice_id
FROM route_messages m JOIN erp_export_rows er ON er.export_id = m.erp_export_id;

INSERT INTO route_message_events (message_id, seq, at, event, detail, actor)
SELECT m.id, 1, m.received_at, 'exported', NULL, x.created_by
FROM route_messages m JOIN erp_exports x ON x.id = m.erp_export_id;

INSERT INTO route_message_events (message_id, seq, at, event, detail, actor)
SELECT m.id, 2, m.received_at, 'delivered', NULL, NULL
FROM route_messages m WHERE m.erp_export_id IS NOT NULL;

INSERT INTO route_message_events (message_id, seq, at, event, detail, actor)
SELECT m.id, 3, replace(x.reversed_at, ' ', 'T') || 'Z', 'undone', x.reverse_reason, x.reversed_by
FROM route_messages m JOIN erp_exports x ON x.id = m.erp_export_id
WHERE x.reversed_at IS NOT NULL;

-- An inbound message may name a source, and never a destination. An
-- outbound one names its destination, and never a source.
-- ASSERT ALWAYS: SELECT count(*) FROM route_messages WHERE direction = 'in' AND destination_id IS NOT NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM route_messages WHERE direction = 'out' AND (destination_id IS NULL OR instance_id IS NOT NULL) == 0
-- An outbound message goes out on a Destination instance.
-- ASSERT ALWAYS: SELECT count(*) FROM route_messages m JOIN route_instances i ON i.id = m.destination_id WHERE i.source_id IS NOT NULL == 0
-- An undone export's messages are closed, not delivered.
-- ASSERT ALWAYS: SELECT count(*) FROM route_messages m JOIN erp_exports x ON x.id = m.erp_export_id WHERE (x.reversed_at IS NOT NULL) != (m.status = 'dismissed') == 0
