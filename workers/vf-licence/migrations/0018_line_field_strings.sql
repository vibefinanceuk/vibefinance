-- 0018_line_field_strings.sql
-- Decision 0110 — the BG-25 line terms, named as the standard names
-- them.
--
-- The wording is the specification's own business term name, not a
-- paraphrase: a person keying an invoice and a tax adviser reading the
-- same document should be using the same words.
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-126', 'en', 'Line no.');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-127', 'en', 'Line note');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-130', 'en', 'Unit');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-132', 'en', 'Order line');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-146', 'en', 'Item net price');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-153', 'en', 'Item name');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-154', 'en', 'Item description');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-126', 'de', 'Pos.');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-127', 'de', 'Positionsnotiz');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-130', 'de', 'Einheit');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-132', 'de', 'Bestellposition');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-146', 'de', 'Nettopreis');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-153', 'de', 'Artikelname');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-154', 'de', 'Artikelbeschreibung');

-- Point-in-time: seven new field labels, in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('field.bt-126','field.bt-127','field.bt-130','field.bt-132','field.bt-146','field.bt-153','field.bt-154') == 14
