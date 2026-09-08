-- 0042_example_facts_strings.sql
-- Decision 0159 — the rest of an example's facts, folded away.
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.morefacts', 'en', 'and {n} other fields on this invoice');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.morefacts', 'de', 'und {n} weitere Felder dieser Rechnung');

-- Point-in-time: it exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'compose.morefacts' == 2
