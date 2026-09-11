-- 0054_supplier_load_error.sql
-- Decision 0216 — a message that names the right layer.
--
-- **The file reached the service and something here went wrong.** Said
-- as itself, because a person told the network failed will retry a load
-- that already succeeded.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.loadbroke', 'en', 'The file was loaded, but this screen could not show the result:'),
 ('suppliers.loadbroke', 'de', 'Die Datei wurde geladen, aber dieser Bildschirm konnte das Ergebnis nicht anzeigen:');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.loadbroke' == 2
