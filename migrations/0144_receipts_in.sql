-- 0144_receipts_in.sql
-- Decision 0655 — Warehouse Receipts, slice 5: receipts arrive by a
-- route.
--
-- **Two standard routes, delivering to the Warehouse Receipts process.**
-- Their versions carry the goods receipt data model, not EN 16931
-- (`semantic_model`, unused until now). Their delivery format is our
-- receipt CSV: what each message is read into before it is checked, as
-- the screen's CSV is.
--
-- - **Receipts in**: HTTPS, with the source's own key (as HTTPS in,
--   0578), JSON or our CSV.
-- - **Receipts upload**: File import. Create's receipt CSV upload is one
--   message of it, from the person.
INSERT INTO routes (id, direction, name, origin) VALUES
  ('receipts-in', 'source', 'Receipts in', 'standard'),
  ('receipts-file', 'source', 'Receipts upload', 'standard');

INSERT INTO route_versions (route_id, version, status, receiving_gateway, receiving_format, translation, delivery_format, delivery_gateway, semantic_model, published_at) VALUES
  ('receipts-in', 1, 'live', 'https', 'detected', 'goods_receipt_v1', 'csv', 'process', 'goods_receipt', datetime('now')),
  ('receipts-file', 1, 'live', 'file_import', 'detected', 'goods_receipt_v1', 'csv', 'process', 'goods_receipt', datetime('now'));

-- **Which message a receipt came in by.** `route_message_items` names
-- invoices only (0106), so the receipt names its message instead.
ALTER TABLE goods_receipts ADD COLUMN route_message_id TEXT REFERENCES route_messages(id);
CREATE INDEX idx_goods_receipts_message ON goods_receipts(route_message_id) WHERE route_message_id IS NOT NULL;

-- **Where the process is already set up (0651)**: its upload source, so
-- Create's receipt CSV is a message of Receipts upload.
INSERT INTO sources (id, process_id, name, mechanism)
  SELECT 'upload-warehouse-receipts', 'warehouse-receipts', 'Receipts upload', 'file_import'
  WHERE EXISTS (SELECT 1 FROM processes WHERE id = 'warehouse-receipts')
    AND NOT EXISTS (SELECT 1 FROM sources WHERE id = 'upload-warehouse-receipts');
INSERT INTO route_instances (id, route_id, process_id, source_id)
  SELECT 'upload-warehouse-receipts', 'receipts-file', 'warehouse-receipts', 'upload-warehouse-receipts'
  WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'upload-warehouse-receipts')
    AND NOT EXISTS (SELECT 1 FROM route_instances WHERE id = 'upload-warehouse-receipts');
