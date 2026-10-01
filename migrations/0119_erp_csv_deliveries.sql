-- 0119_erp_csv_deliveries.sql
-- Decision 0586 — the ERP CSV file on the delivery engine (connector
-- framework, slice 1). Each invoice an export took is now also a delivery
-- of its process's ERP Destination, in the same ledger HTTPS out keeps
-- (0585): one per invoice, its message, the export as its reference.
-- Exports already made are recorded here, from their outbound messages
-- (0558); undone ones are not, as their invoices went back to ready.

INSERT OR IGNORE INTO destination_deliveries
  (instance_id, invoice_id, status, attempts, message_id, reference, created_at, delivered_at)
SELECT m.destination_id, i.item_id, 'delivered', 1, m.id, m.erp_export_id, m.received_at, m.received_at
FROM route_messages m
JOIN route_message_items i ON i.message_id = m.id AND i.item_type = 'invoice'
JOIN erp_export_invoices e ON e.invoice_id = i.item_id AND e.export_id = m.erp_export_id
JOIN route_instances d ON d.id = m.destination_id AND d.route_id = 'erp-csv'
WHERE m.direction = 'out' AND m.erp_export_id IS NOT NULL;

-- Every ERP delivery is of an export that still holds its invoice.
-- ASSERT ALWAYS: SELECT count(*) FROM destination_deliveries d JOIN route_instances r ON r.id = d.instance_id AND r.route_id = 'erp-csv' WHERE NOT EXISTS (SELECT 1 FROM erp_export_invoices e WHERE e.invoice_id = d.invoice_id AND e.export_id = d.reference) == 0
