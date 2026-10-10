-- 0320_duplicate_check_strings.sql
-- Decision 0711 — the invoice number turns green when it is not a possible
-- duplicate of an earlier invoice from the same supplier, and amber when it is.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('check.duplicate', 'en', 'Possibly a duplicate of an earlier invoice from this supplier'),
 ('check.duplicate', 'de', 'Möglicherweise ein Duplikat einer früheren Rechnung dieses Lieferanten'),
 ('check.duplicate.ok', 'en', 'Not a duplicate of an earlier invoice from this supplier'),
 ('check.duplicate.ok', 'de', 'Kein Duplikat einer früheren Rechnung dieses Lieferanten');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('check.duplicate', 'check.duplicate.ok') == 4
