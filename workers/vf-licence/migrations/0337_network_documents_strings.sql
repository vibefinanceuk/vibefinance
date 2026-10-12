-- 0337_network_documents_strings.sql
-- Decision 0736 — the network's Documents as the app's: pages, rows per page and columns.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.col.due', 'en', 'Due date'),
 ('network.col.due', 'de', 'Fällig am'),
 ('network.col.currency', 'en', 'Currency'),
 ('network.col.currency', 'de', 'Währung'),
 ('network.col.buyerref', 'en', 'Buyer reference'),
 ('network.col.buyerref', 'de', 'Käuferreferenz'),
 ('network.col.received', 'en', 'Received'),
 ('network.col.received', 'de', 'Eingegangen'),
 ('network.col.credits', 'en', 'Credits invoice'),
 ('network.col.credits', 'de', 'Schreibt Rechnung gut'),
 ('network.choosecolumns', 'en', 'Choose columns'),
 ('network.choosecolumns', 'de', 'Spalten wählen'),
 ('network.rows', 'en', 'Rows'),
 ('network.rows', 'de', 'Zeilen'),
 ('network.page.first', 'en', 'First page'),
 ('network.page.first', 'de', 'Erste Seite'),
 ('network.page.prev', 'en', 'Previous page'),
 ('network.page.prev', 'de', 'Vorherige Seite'),
 ('network.page.next', 'en', 'Next page'),
 ('network.page.next', 'de', 'Nächste Seite'),
 ('network.page.last', 'en', 'Last page'),
 ('network.page.last', 'de', 'Letzte Seite'),
 ('network.range', 'en', '{from}–{to} of {total}'),
 ('network.range', 'de', '{from}–{to} von {total}'),
 ('network.capped', 'en', 'Showing the newest 500 from {list}. Search or filter to find older ones.'),
 ('network.capped', 'de', 'Es werden die neuesten 500 von {list} angezeigt. Suchen oder filtern Sie, um ältere zu finden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.col.due', 'network.col.currency', 'network.col.buyerref', 'network.col.received', 'network.col.credits', 'network.choosecolumns', 'network.rows', 'network.page.first', 'network.page.prev', 'network.page.next', 'network.page.last', 'network.range', 'network.capped') == 26
