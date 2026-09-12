-- 0077_name_a_rule.sql
--
-- Decision 0266 — a rule gets a short name of its own, separate from
-- the sentence it was compiled from, set when writing a new one
-- (compose.js) or changed afterward without recompiling (rule.js).
INSERT INTO ui_strings (key, locale, value) VALUES
 ('compose.namelabel', 'en', 'Give it a name (optional)'),
 ('compose.nameplaceholder', 'en', 'e.g. Spend Threshold'),
 ('rule.rename', 'en', 'Rename'),
 ('rule.namethis', 'en', 'Name this rule'),
 ('rule.unnamed', 'en', 'Not yet named');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('compose.namelabel', 'de', 'Name vergeben (optional)'),
 ('compose.nameplaceholder', 'de', 'z. B. Ausgabenschwelle'),
 ('rule.rename', 'de', 'Umbenennen'),
 ('rule.namethis', 'de', 'Diese Regel benennen'),
 ('rule.unnamed', 'de', 'Noch nicht benannt');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('compose.namelabel','compose.nameplaceholder','rule.rename','rule.namethis','rule.unnamed') == 10
