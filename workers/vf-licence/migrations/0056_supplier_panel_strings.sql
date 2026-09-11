-- 0056_supplier_panel_strings.sql
-- Decision 0219 — our record of the supplier, beside the document.
--
-- **The unmatched reasons get their own sentences**, because three
-- causes need three actions: nobody named on the document, nobody in
-- the list, or several sites and no way to choose.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier', 'en', 'Supplier on file'),
 ('viewer.supplier.name', 'en', 'Name'),
 ('viewer.supplier.vat', 'en', 'VAT number'),
 ('viewer.supplier.endpoint', 'en', 'Electronic address'),
 ('viewer.supplier.email', 'en', 'Email'),
 ('viewer.supplier.street', 'en', 'Address'),
 ('viewer.supplier.city', 'en', 'City'),
 ('viewer.supplier.postcode', 'en', 'Postcode'),
 ('viewer.supplier.country', 'en', 'Country'),
 ('viewer.supplier.onhold', 'en', 'This supplier is on hold:'),
 ('viewer.supplier.none', 'en', 'This invoice has not been matched to a supplier.'),
 ('viewer.supplier.no_identifier', 'en', 'The document gives no seller VAT number or electronic address, so it cannot be matched to a supplier.'),
 ('viewer.supplier.no_match', 'en', 'No supplier on file matches this seller. They may be new, or the supplier list may need reloading.'),
 ('viewer.supplier.ambiguous_site', 'en', 'Several supplier sites share this VAT number and more than one takes payment, so the right one cannot be chosen automatically.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier', 'de', 'Hinterlegter Lieferant'),
 ('viewer.supplier.name', 'de', 'Name'),
 ('viewer.supplier.vat', 'de', 'USt-IdNr.'),
 ('viewer.supplier.endpoint', 'de', 'Elektronische Adresse'),
 ('viewer.supplier.email', 'de', 'E-Mail'),
 ('viewer.supplier.street', 'de', 'Anschrift'),
 ('viewer.supplier.city', 'de', 'Stadt'),
 ('viewer.supplier.postcode', 'de', 'Postleitzahl'),
 ('viewer.supplier.country', 'de', 'Land'),
 ('viewer.supplier.onhold', 'de', 'Dieser Lieferant ist gesperrt:'),
 ('viewer.supplier.none', 'de', 'Diese Rechnung wurde keinem Lieferanten zugeordnet.'),
 ('viewer.supplier.no_identifier', 'de', 'Der Beleg nennt weder USt-IdNr. noch elektronische Adresse des Verkäufers, daher ist keine Zuordnung möglich.'),
 ('viewer.supplier.no_match', 'de', 'Kein hinterlegter Lieferant passt zu diesem Verkäufer. Er ist möglicherweise neu, oder die Lieferantenliste muss neu geladen werden.'),
 ('viewer.supplier.ambiguous_site', 'de', 'Mehrere Lieferantenstandorte teilen diese USt-IdNr. und mehr als einer nimmt Zahlungen entgegen, daher kann der richtige nicht automatisch gewählt werden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'viewer.supplier%' == 28
