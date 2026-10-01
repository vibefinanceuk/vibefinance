-- 0233_erp_deliveries_strings.sql
-- Decision 0586. The ERP CSV file's exports, shown as deliveries on its
-- Destination panel.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('erpout.export', 'en', 'export {id}'),
 ('erpout.export', 'de', 'Export {id}'),
 ('erpout.deliverieshint', 'en', 'Each invoice an export took, delivered by the file. Each export is a message in the Route monitor. Undoing an export on the ERP export screen puts its invoices back to ready.'),
 ('erpout.deliverieshint', 'de', 'Jede Rechnung, die ein Export übernommen hat, zugestellt durch die Datei. Jeder Export ist eine Nachricht im Routen-Monitor. Ein Export, der auf dem ERP-Export-Bildschirm rückgängig gemacht wird, stellt seine Rechnungen wieder bereit.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('erpout.export','erpout.deliverieshint') == 4
