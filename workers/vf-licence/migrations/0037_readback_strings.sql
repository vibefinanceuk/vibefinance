-- 0037_readback_strings.sql
-- Decision 0153 — a compiled rule, read back in words.
--
-- **The operators are the grammar.** Rendering `is_not` as "is not" in
-- code would put English grammar in a screen whose nouns come from D1 —
-- a German customer would read "die Gesamtsumme is not 1000", which is
-- worse than either language alone.
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is', 'en', 'is');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is_not', 'en', 'is not');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.in', 'en', 'is one of');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.not_in', 'en', 'is none of');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.greater_than', 'en', 'is more than');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.less_than', 'en', 'is less than');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.between', 'en', 'is between');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.starts_with', 'en', 'starts with');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.contains', 'en', 'contains');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is_present', 'en', 'is given');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is_empty', 'en', 'is missing');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.older_than_days', 'en', 'is older than, in days,');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.within_days', 'en', 'is within, in days,');
-- The sentence's own joins.
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.the', 'en', 'the');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.or', 'en', 'or');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.then', 'en', 'Then:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.when_all', 'en', 'When all of these are true:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.when_any', 'en', 'When any of these is true:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.nested_all', 'en', 'and all of these:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.nested_any', 'en', 'and any of these:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.check', 'en', 'Read this before the examples. If it does not match what you meant, change the sentence rather than the examples.');

INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is', 'de', 'ist');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is_not', 'de', 'ist nicht');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.in', 'de', 'ist eines von');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.not_in', 'de', 'ist keines von');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.greater_than', 'de', 'ist größer als');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.less_than', 'de', 'ist kleiner als');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.between', 'de', 'liegt zwischen');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.starts_with', 'de', 'beginnt mit');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.contains', 'de', 'enthält');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is_present', 'de', 'ist angegeben');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.is_empty', 'de', 'fehlt');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.older_than_days', 'de', 'ist älter als, in Tagen,');
INSERT INTO ui_strings (key, locale, value) VALUES ('operator.within_days', 'de', 'liegt innerhalb von, in Tagen,');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.the', 'de', 'die');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.or', 'de', 'oder');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.then', 'de', 'Dann:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.when_all', 'de', 'Wenn alle diese zutreffen:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.when_any', 'de', 'Wenn eine davon zutrifft:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.nested_all', 'de', 'und alle diese:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.nested_any', 'de', 'und eine davon:');
INSERT INTO ui_strings (key, locale, value) VALUES ('readback.check', 'de', 'Lesen Sie dies vor den Beispielen. Stimmt es nicht mit Ihrer Absicht überein, ändern Sie den Satz und nicht die Beispiele.');

-- Point-in-time: every operator and join exists in both languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'operator.%' OR key LIKE 'readback.%' == 42
