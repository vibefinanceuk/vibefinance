-- 0112_purchase_orders_format_reference_strings.sql
-- Decision 0373 — the CSV format reference and template download, on
-- the operator's own observation that a one-line hint left a person
-- with no way to discover the other columns a file could carry.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.download', 'en', 'Download'),
 ('purchaseorders.viewformat', 'en', 'View accepted columns'),
 ('purchaseorders.fieldname', 'en', 'Field'),
 ('purchaseorders.acceptedcolumns', 'en', 'Accepted column names'),
 ('purchaseorders.required', 'en', 'Required'),
 ('purchaseorders.headercolumns', 'en', 'Header columns'),
 ('purchaseorders.linecolumns', 'en', 'Line columns');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.download', 'de', 'Herunterladen'),
 ('purchaseorders.viewformat', 'de', 'Zulässige Spalten anzeigen'),
 ('purchaseorders.fieldname', 'de', 'Feld'),
 ('purchaseorders.acceptedcolumns', 'de', 'Zulässige Spaltennamen'),
 ('purchaseorders.required', 'de', 'Erforderlich'),
 ('purchaseorders.headercolumns', 'de', 'Kopfspalten'),
 ('purchaseorders.linecolumns', 'de', 'Positionsspalten');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.download','purchaseorders.viewformat','purchaseorders.fieldname','purchaseorders.acceptedcolumns','purchaseorders.required','purchaseorders.headercolumns','purchaseorders.linecolumns') == 14
