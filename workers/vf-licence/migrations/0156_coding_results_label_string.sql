-- 0156_coding_results_label_string.sql
-- The Coding pop-out's search results moved to one shared area below
-- all four fields, sized to fit the pop-out rather than the other way
-- around — decision 0458, reported live from a mock-up: per-field
-- results used to grow and shrink the whole pop-out on every
-- keystroke. Only one field's results show there at a time, so the
-- area needs to say which field a click will fill.
--
-- One new key: the label prefix, e.g. "Results for Project". The field
-- name itself is not part of this string — it's appended in `viewer.js`
-- from the same `field.*` label the line table's own column headers
-- and this pop-out's own field labels already use, so it's never
-- translated twice.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.resultsfor', 'en', 'Results for');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.resultsfor', 'de', 'Ergebnisse für');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.coding.resultsfor' == 2
