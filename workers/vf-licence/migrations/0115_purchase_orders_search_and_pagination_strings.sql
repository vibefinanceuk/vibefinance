-- 0115_purchase_orders_search_and_pagination_strings.sql
-- Decision 0376 — the search box and pagination controls above the
-- purchase orders list.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.searchplaceholder', 'en', 'Search order number, seller, item...'),
 ('purchaseorders.rows', 'en', 'Rows'),
 ('purchaseorders.rangeof', 'en', '{start}–{end} of {total}'),
 ('purchaseorders.firstpage', 'en', 'First page'),
 ('purchaseorders.previouspage', 'en', 'Previous page'),
 ('purchaseorders.nextpage', 'en', 'Next page'),
 ('purchaseorders.lastpage', 'en', 'Last page'),
 ('purchaseorders.nomatches', 'en', 'No purchase orders match your search.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.searchplaceholder', 'de', 'Bestellnummer, Verkäufer, Artikel suchen...'),
 ('purchaseorders.rows', 'de', 'Zeilen'),
 ('purchaseorders.rangeof', 'de', '{start}–{end} von {total}'),
 ('purchaseorders.firstpage', 'de', 'Erste Seite'),
 ('purchaseorders.previouspage', 'de', 'Vorherige Seite'),
 ('purchaseorders.nextpage', 'de', 'Nächste Seite'),
 ('purchaseorders.lastpage', 'de', 'Letzte Seite'),
 ('purchaseorders.nomatches', 'de', 'Keine Bestellungen entsprechen Ihrer Suche.');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('purchaseorders.searchplaceholder','purchaseorders.rows','purchaseorders.rangeof','purchaseorders.firstpage','purchaseorders.previouspage','purchaseorders.nextpage','purchaseorders.lastpage','purchaseorders.nomatches') == 16
