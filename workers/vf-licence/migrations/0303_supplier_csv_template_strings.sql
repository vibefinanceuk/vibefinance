-- 0303_supplier_csv_template_strings.sql
-- Decision 0665 — Suppliers: Load CSV and CSV Template.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.loadcsv', 'en', 'Load CSV'),
 ('suppliers.loadcsv', 'de', 'CSV laden'),
 ('suppliers.templatebutton', 'en', 'CSV Template'),
 ('suppliers.templatebutton', 'de', 'CSV-Vorlage'),
 ('suppliers.templatefailed', 'en', 'The template could not be downloaded.'),
 ('suppliers.templatefailed', 'de', 'Die Vorlage konnte nicht heruntergeladen werden.'),
 ('suppliers.lastload', 'en', 'Last supplier load occurred {days} days ago.'),
 ('suppliers.lastload', 'de', 'Die letzte Lieferantenladung erfolgte vor {days} Tagen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.loadcsv', 'suppliers.templatebutton', 'suppliers.templatefailed', 'suppliers.lastload') == 8
