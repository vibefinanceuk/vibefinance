-- 0053_supplier_screen_strings.sql
-- Decision 0213 — the supplier screen.
--
-- **We are the mirror** (decision 0208), and the words say so. There is
-- no *Add supplier*, and a person who does not know why will conclude
-- the product is missing one.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.suppliers', 'en', 'Suppliers'),
 ('suppliers.heading', 'en', 'Suppliers'),
 ('suppliers.mirror', 'en', 'Loaded from your ERP. Suppliers are created and changed there, not here.'),
 ('suppliers.failed', 'en', 'The supplier list could not be loaded.'),
 ('suppliers.none', 'en', 'No suppliers have been loaded yet.'),
 ('suppliers.neverloaded', 'en', 'No supplier file has ever been loaded, so every invoice will arrive without a supplier.'),
 ('suppliers.loadedago', 'en', 'Loaded {days} days ago.'),
 ('suppliers.hadrefusals', 'en', 'That file had {n} rows which could not be loaded.'),
 ('suppliers.loadheading', 'en', 'Load a supplier file'),
 ('suppliers.loadhelp', 'en', 'A CSV exported from your ERP. It needs a supplier number column — without it an invoice cannot be matched to a supplier your ERP knows.'),
 ('suppliers.loadbutton', 'en', 'Load'),
 ('suppliers.loading', 'en', 'Loading...'),
 ('suppliers.nofile', 'en', 'Choose a file first.'),
 ('suppliers.loadfailed', 'en', 'We could not reach the service to load that file.'),
 ('suppliers.loaded', 'en', '{n} suppliers loaded.'),
 ('suppliers.deactivated', 'en', '{n} suppliers were not in this file and are now inactive.'),
 ('suppliers.rematched', 'en', '{n} invoices which had no supplier now have one.'),
 ('suppliers.refusedheading', 'en', 'Rows which could not be loaded'),
 ('suppliers.refusedrow', 'en', 'Row {row}: {reason}'),
 ('suppliers.refusedmore', 'en', 'and {n} more.'),
 ('suppliers.erpid', 'en', 'Supplier number'),
 ('suppliers.name', 'en', 'Name'),
 ('suppliers.vat', 'en', 'VAT number'),
 ('suppliers.country', 'en', 'Country'),
 ('suppliers.terms', 'en', 'Terms'),
 ('suppliers.hold', 'en', 'Hold'),
 ('suppliers.status', 'en', 'Status');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.suppliers', 'de', 'Lieferanten'),
 ('suppliers.heading', 'de', 'Lieferanten'),
 ('suppliers.mirror', 'de', 'Aus Ihrem ERP geladen. Lieferanten werden dort angelegt und geändert, nicht hier.'),
 ('suppliers.failed', 'de', 'Die Lieferantenliste konnte nicht geladen werden.'),
 ('suppliers.none', 'de', 'Es wurden noch keine Lieferanten geladen.'),
 ('suppliers.neverloaded', 'de', 'Es wurde noch nie eine Lieferantendatei geladen, daher kommt jede Rechnung ohne Lieferanten an.'),
 ('suppliers.loadedago', 'de', 'Vor {days} Tagen geladen.'),
 ('suppliers.hadrefusals', 'de', 'Diese Datei hatte {n} Zeilen, die nicht geladen werden konnten.'),
 ('suppliers.loadheading', 'de', 'Lieferantendatei laden'),
 ('suppliers.loadhelp', 'de', 'Eine CSV-Datei aus Ihrem ERP. Sie benötigt eine Spalte mit der Lieferantennummer — ohne sie kann eine Rechnung keinem Lieferanten zugeordnet werden, den Ihr ERP kennt.'),
 ('suppliers.loadbutton', 'de', 'Laden'),
 ('suppliers.loading', 'de', 'Wird geladen...'),
 ('suppliers.nofile', 'de', 'Wählen Sie zuerst eine Datei.'),
 ('suppliers.loadfailed', 'de', 'Der Dienst zum Laden der Datei war nicht erreichbar.'),
 ('suppliers.loaded', 'de', '{n} Lieferanten geladen.'),
 ('suppliers.deactivated', 'de', '{n} Lieferanten waren nicht in dieser Datei und sind jetzt inaktiv.'),
 ('suppliers.rematched', 'de', '{n} Rechnungen ohne Lieferanten haben jetzt einen.'),
 ('suppliers.refusedheading', 'de', 'Zeilen, die nicht geladen werden konnten'),
 ('suppliers.refusedrow', 'de', 'Zeile {row}: {reason}'),
 ('suppliers.refusedmore', 'de', 'und {n} weitere.'),
 ('suppliers.erpid', 'de', 'Lieferantennummer'),
 ('suppliers.name', 'de', 'Name'),
 ('suppliers.vat', 'de', 'USt-IdNr.'),
 ('suppliers.country', 'de', 'Land'),
 ('suppliers.terms', 'de', 'Zahlungsziel'),
 ('suppliers.hold', 'de', 'Sperre'),
 ('suppliers.status', 'de', 'Status');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'suppliers.%' OR key = 'nav.suppliers' == 54
