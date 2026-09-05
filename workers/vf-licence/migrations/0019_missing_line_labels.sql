-- 0019_missing_line_labels.sql
-- Decision 0107 — two labels the line table used and nothing seeded.
--
-- **Reported from the screen**: the table's headers read `field.bt-129`
-- and `field.bt-131`, which mean nothing to anybody keying an invoice.
--
-- Not a naming philosophy problem. `t()` falls back to the key when a
-- string is missing, deliberately — *"a screen reading a dotted key is
-- obviously broken and somebody reports it, where a blank looks like a
-- data problem and gets lived with"*. The fallback worked and the
-- operator was the person reporting it.
--
-- **The words are the specification's own business term names**, in the
-- form a person keying an invoice would use: EN 16931 calls BT-129
-- "Invoiced quantity" and BT-131 "Invoice line net amount", shortened
-- here only where a table column has no room for the full term.
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-129', 'en', 'Quantity');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-131', 'en', 'Line net amount');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-129', 'de', 'Menge');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-131', 'de', 'Nettobetrag der Position');

-- Point-in-time: both exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('field.bt-129','field.bt-131') == 4
