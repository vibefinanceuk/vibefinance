-- 0031_action_strings.sql
-- Decision 0138 — the words the action row needs to work.
--
-- **Returning and discarding need a reason**, and decisions 0075 and
-- 0078 made that a requirement rather than a courtesy: a document that
-- comes back with no explanation is one the next person cannot act on,
-- and a discarded one has nothing but the record of why.
INSERT INTO ui_strings (key, locale, value) VALUES ('action.whyreason', 'en', 'Give a reason. The next person to see this document will read it.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.actionfailed', 'en', 'That could not be done.');

INSERT INTO ui_strings (key, locale, value) VALUES ('action.whyreason', 'de', 'Bitte einen Grund angeben. Die nächste Person, die dieses Dokument sieht, wird ihn lesen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.actionfailed', 'de', 'Das konnte nicht ausgeführt werden.');

-- Point-in-time: both exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.whyreason','viewer.actionfailed') == 4
