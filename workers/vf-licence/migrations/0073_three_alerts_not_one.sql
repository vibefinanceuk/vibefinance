-- 0073_three_alerts_not_one.sql
--
-- Decision 0259 — the operator asked for the combined "Needs somebody"
-- card to become three, each with a graphic and a link.
--
-- **`dash.about.needs_somebody` is left in place**, unused, per decision
-- 0071's own rule: a string a customer may already have translated is
-- not something to remove in passing. Only the new pairs are added.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.unplaced_documents', 'en', 'Unplaced documents'),
 ('dash.about.unplaced_documents', 'en', 'No business unit could be assigned'),
 ('dash.suppliers_awaiting_erp', 'en', 'Suppliers awaiting the ERP'),
 ('dash.about.suppliers_awaiting_erp', 'en', 'No identifier from the system of record'),
 ('dash.possible_duplicates', 'en', 'Possible duplicates'),
 ('dash.about.possible_duplicates', 'en', 'Invoices that may already be on file');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.unplaced_documents', 'de', 'Nicht zugeordnete Belege'),
 ('dash.about.unplaced_documents', 'de', 'Keine Organisationseinheit konnte zugewiesen werden'),
 ('dash.suppliers_awaiting_erp', 'de', 'Lieferanten ohne ERP-Kennung'),
 ('dash.about.suppliers_awaiting_erp', 'de', 'Keine Kennung aus dem führenden System'),
 ('dash.possible_duplicates', 'de', 'Mögliche Duplikate'),
 ('dash.about.possible_duplicates', 'de', 'Rechnungen, die bereits erfasst sein könnten');

-- The drill-through screens: what a filtered view says about itself,
-- and how to leave it — decision 0259, matching decision 0256's rule
-- that a filtered screen must say so rather than look like everything.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.unplaced', 'en', 'Showing unplaced documents only'),
 ('documents.showing.duplicates', 'en', 'Showing possible duplicates only'),
 ('documents.clearfilter', 'en', 'Clear filter'),
 ('suppliers.showingawaiting', 'en', 'Showing suppliers awaiting the ERP only'),
 ('suppliers.noneawaiting', 'en', 'No suppliers are awaiting the ERP.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.unplaced', 'de', 'Zeigt nur nicht zugeordnete Belege'),
 ('documents.showing.duplicates', 'de', 'Zeigt nur mögliche Duplikate'),
 ('documents.clearfilter', 'de', 'Filter aufheben'),
 ('suppliers.showingawaiting', 'de', 'Zeigt nur Lieferanten ohne ERP-Kennung'),
 ('suppliers.noneawaiting', 'de', 'Kein Lieferant wartet auf eine ERP-Kennung.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('dash.unplaced_documents','dash.about.unplaced_documents','dash.suppliers_awaiting_erp','dash.about.suppliers_awaiting_erp','dash.possible_duplicates','dash.about.possible_duplicates','documents.showing.unplaced','documents.showing.duplicates','documents.clearfilter','suppliers.showingawaiting','suppliers.noneawaiting') == 22
