-- 0151_tasks_search_and_pagination_strings.sql
-- Decision 0449 — the search box and pagination controls above the
-- Tasks list.
--
-- The pagination controls themselves (Rows, First/Previous/Next/Last
-- page, the "{start}–{end} of {total}" range text) reuse
-- `purchaseorders.*`, the same shared keys `documents.js` already
-- reuses for its own decision-0448 controls — no new keys needed for
-- those. Only three are new here: the search placeholder, the
-- "nothing matches" empty state a search can now produce (distinct
-- from `tasks.empty`, which still means "nothing in the queue at
-- all"), and the counts line, split out of a hand-built template
-- string so it can be translated rather than assembled from English
-- words around three numbers.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('tasks.searchhint', 'en', 'Stage, supplier, or amount'),
 ('tasks.nomatch', 'en', 'Nothing matches that. Try a stage, a supplier, or an amount.'),
 ('tasks.countsline', 'en', '{mine} mine · {available} available · {locked} held');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('tasks.searchhint', 'de', 'Phase, Lieferant oder Betrag'),
 ('tasks.nomatch', 'de', 'Dazu passt nichts. Versuchen Sie eine Phase, einen Lieferanten oder einen Betrag.'),
 ('tasks.countsline', 'de', '{mine} meine · {available} verfügbar · {locked} gehalten');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('tasks.searchhint','tasks.nomatch','tasks.countsline') == 6
