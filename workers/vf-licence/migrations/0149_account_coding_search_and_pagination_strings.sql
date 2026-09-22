-- 0149_account_coding_search_and_pagination_strings.sql
--
-- Decision 0446 — search and real, SQL-pushed pagination for the
-- Account Coding tab's four manageable tables (Cost Centre, Project,
-- Commodity Code, General Ledger Code). The pagination controls
-- themselves reuse purchase-orders.js's own generic strings
-- (purchaseorders.rows, .firstpage, .previouspage, .nextpage,
-- .lastpage, .rangeof, from migration 0115) rather than duplicating
-- them here — only the search placeholder and the "no matches" empty
-- state are genuinely new to this screen.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.codingsearchplaceholder', 'en', 'Search'),
 ('apsetup.codingnomatches', 'en', 'No entries match your search.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.codingsearchplaceholder', 'de', 'Suchen'),
 ('apsetup.codingnomatches', 'de', 'Keine Einträge entsprechen Ihrer Suche.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.codingsearchplaceholder','apsetup.codingnomatches') == 4
