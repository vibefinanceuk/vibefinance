-- 0017_line_keying_strings.sql
-- Decision 0109 — the words the line table needs.
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.lines', 'en', 'Invoice lines');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.description', 'en', 'Description');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.addline', 'en', 'Add line');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.removeline', 'en', 'Remove this line');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.linetotal', 'en', 'Lines total');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.matches', 'en', 'matches the printed total');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.differs', 'en', 'differs by');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.lines', 'de', 'Rechnungspositionen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.description', 'de', 'Beschreibung');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.addline', 'de', 'Position hinzufügen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.removeline', 'de', 'Diese Position entfernen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.linetotal', 'de', 'Summe der Positionen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.matches', 'de', 'stimmt mit dem Gesamtbetrag überein');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.differs', 'de', 'weicht ab um');

-- Point-in-time: seven new keys, in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'viewer.line%' OR key IN ('viewer.description','viewer.addline','viewer.removeline','viewer.matches','viewer.differs') == 14
