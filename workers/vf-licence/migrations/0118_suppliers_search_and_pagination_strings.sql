-- 0118_suppliers_search_and_pagination_strings.sql
-- Decision 0378 — the search-and-paginate card for Suppliers, mirroring
-- decision 0376's own strings for Purchase Orders. suppliers.rangeof
-- reuses the same {start}/{end}/{total} placeholder shape.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.searchplaceholder', 'en', 'Search suppliers'),
 ('suppliers.rows', 'en', 'Rows'),
 ('suppliers.rangeof', 'en', '{start}–{end} of {total}'),
 ('suppliers.firstpage', 'en', 'First page'),
 ('suppliers.previouspage', 'en', 'Previous page'),
 ('suppliers.nextpage', 'en', 'Next page'),
 ('suppliers.lastpage', 'en', 'Last page'),
 ('suppliers.nomatches', 'en', 'No suppliers match your search.'),
 ('suppliers.nostatusdata', 'en', 'No status data to show yet.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.searchplaceholder', 'de', 'Lieferanten suchen'),
 ('suppliers.rows', 'de', 'Zeilen'),
 ('suppliers.rangeof', 'de', '{start}–{end} von {total}'),
 ('suppliers.firstpage', 'de', 'Erste Seite'),
 ('suppliers.previouspage', 'de', 'Vorherige Seite'),
 ('suppliers.nextpage', 'de', 'Nächste Seite'),
 ('suppliers.lastpage', 'de', 'Letzte Seite'),
 ('suppliers.nomatches', 'de', 'Keine Lieferanten entsprechen Ihrer Suche.'),
 ('suppliers.nostatusdata', 'de', 'Noch keine Statusdaten vorhanden.');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.searchplaceholder','suppliers.rows','suppliers.rangeof','suppliers.firstpage','suppliers.previouspage','suppliers.nextpage','suppliers.lastpage','suppliers.nomatches','suppliers.nostatusdata') == 18
