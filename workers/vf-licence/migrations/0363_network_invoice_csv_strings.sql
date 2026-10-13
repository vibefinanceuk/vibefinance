-- 0363_network_invoice_csv_strings.sql
-- Decision 0772 — an invoice's CSV on its Attachments tab in the supplier network, rather than Download in the top bar.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.invoice.file.csv', 'en', 'Spreadsheet (CSV)'),
 ('network.invoice.file.csv', 'de', 'Tabelle (CSV)');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.invoice.file.csv') == 2
