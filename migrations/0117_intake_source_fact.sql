-- 0117_intake_source_fact.sql
-- Decision 0584 — intake.source: which source an invoice arrived through,
-- by id, so a rule can say "invoices from the UK mailbox". New invoices
-- get it at capture. Invoices already received get it here, from the
-- route message that made them (0555, 0571), where that message arrived
-- on a source.

UPDATE invoice_headers
SET facts_json = json_set(
  COALESCE(facts_json, '{}'),
  '$."intake.source"',
  (SELECT m.instance_id FROM route_message_items i
     JOIN route_messages m ON m.id = i.message_id
     JOIN sources s ON s.id = m.instance_id
   WHERE i.item_type = 'invoice' AND i.item_id = invoice_headers.id
   ORDER BY m.received_at LIMIT 1)
)
WHERE json_extract(COALESCE(facts_json, '{}'), '$."intake.source"') IS NULL
  AND EXISTS (
    SELECT 1 FROM route_message_items i
      JOIN route_messages m ON m.id = i.message_id
      JOIN sources s ON s.id = m.instance_id
    WHERE i.item_type = 'invoice' AND i.item_id = invoice_headers.id
  );

-- Point-in-time: every invoice a source's message made now says which source.
-- ASSERT: SELECT count(*) FROM invoice_headers h WHERE json_extract(h.facts_json, '$."intake.source"') IS NULL AND EXISTS (SELECT 1 FROM route_message_items i JOIN route_messages m ON m.id = i.message_id JOIN sources s ON s.id = m.instance_id WHERE i.item_type = 'invoice' AND i.item_id = h.id) == 0
