-- 0249_oracle_connector_strings.sql
-- Decision 0605. Oracle Fusion Payables, and mapping fields built from parts.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('library.firstversion', 'en', 'First version'),
 ('library.firstversion', 'de', 'Erste Version'),
 ('library.firstversionhint', 'en', 'Built from the vendor''s documented API and proved against a simulated system, not yet a live one. Try it on a test environment before production.'),
 ('library.firstversionhint', 'de', 'Nach der dokumentierten API des Anbieters gebaut und an einem simulierten System erprobt, noch nicht an einem echten. Testen Sie es vor dem Produktivbetrieb in einer Testumgebung.'),
 ('outmap.builtfrom', 'en', 'Built from'),
 ('outmap.builtfrom', 'de', 'Zusammengesetzt aus'),
 ('outmap.orbuilt', 'en', 'Or built from'),
 ('outmap.orbuilt', 'de', 'Oder zusammengesetzt aus'),
 ('outmap.builtplaceholder', 'en', 'such as {company|Oracle company segments}-{distribution.costCentre}-{distribution.glCode}'),
 ('outmap.builtplaceholder', 'de', 'etwa {company|Oracle company segments}-{distribution.costCentre}-{distribution.glCode}'),
 ('outmap.builthint', 'en', 'Each part in braces is a field of the invoice, and a part with a list after a bar is looked up in that look-up list. If any part is empty, so is the field.'),
 ('outmap.builthint', 'de', 'Jeder Teil in geschweiften Klammern ist ein Feld der Rechnung, ein Teil mit einer Liste nach einem senkrechten Strich wird in dieser Nachschlageliste nachgeschlagen. Ist ein Teil leer, ist es auch das Feld.'),
 ('outmap.builtunknownlist', 'en', 'There is no look-up list called {name}.'),
 ('outmap.builtunknownlist', 'de', 'Es gibt keine Nachschlageliste namens {name}.'),
 ('outmap.src.distribution.numberinline', 'en', 'Number in its line'),
 ('outmap.src.distribution.numberinline', 'de', 'Nummer innerhalb der Position');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('library.firstversion','library.firstversionhint','outmap.builtfrom','outmap.orbuilt','outmap.builtplaceholder','outmap.builthint','outmap.builtunknownlist','outmap.src.distribution.numberinline') == 16
