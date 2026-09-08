-- 0045_line_description_label.sql
-- Decision 0171 — the line description's own label.
--
-- **Added as a displayable field and never given a word.** Every field
-- label comes from `field.<code>` in D1, and the viewer showed
-- `field.description` — the key itself — on the line table's header.
--
-- Decision 0158's coverage test derives action and operator labels from
-- the vocabulary and catches a missing one. **This field is
-- deliberately not in the vocabulary**, so nothing enumerable could
-- have caught it — the same blind spot decision 0165 recorded about
-- screen strings.
INSERT INTO ui_strings (key, locale, value) VALUES ('field.description', 'en', 'Description');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.description', 'de', 'Beschreibung');

-- Point-in-time: it exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'field.description' == 2
