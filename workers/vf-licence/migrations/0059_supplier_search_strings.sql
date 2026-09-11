-- 0059_supplier_search_strings.sql
-- Decision 0222 — finding a supplier by hand.
--
-- **Leaving it is a real answer**, and the words say so. The operator:
-- *"if not, the user can just leave it, to be picked up later in AP
-- Review."* A box that only offers success makes a person feel they
-- have failed at something they have not.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier.find', 'en', 'Find a supplier'),
 ('viewer.supplier.findheading', 'en', 'Find a supplier'),
 ('viewer.supplier.searchhint', 'en', 'Name, VAT number, address or supplier number'),
 ('viewer.supplier.orleave', 'en', 'If this supplier is not on file, leave it — the invoice will be reviewed later.'),
 ('viewer.supplier.nomatches', 'en', 'Nothing on file matches that.'),
 ('viewer.supplier.searchfailed', 'en', 'We could not reach the service to search.'),
 ('viewer.supplier.choosefailed', 'en', 'We could not reach the service to set that supplier.'),
 ('viewer.supplier.close', 'en', 'Close');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier.find', 'de', 'Lieferant suchen'),
 ('viewer.supplier.findheading', 'de', 'Lieferant suchen'),
 ('viewer.supplier.searchhint', 'de', 'Name, USt-IdNr., Anschrift oder Lieferantennummer'),
 ('viewer.supplier.orleave', 'de', 'Wenn dieser Lieferant nicht hinterlegt ist, lassen Sie es — die Rechnung wird später geprüft.'),
 ('viewer.supplier.nomatches', 'de', 'Dazu passt nichts Hinterlegtes.'),
 ('viewer.supplier.searchfailed', 'de', 'Der Suchdienst war nicht erreichbar.'),
 ('viewer.supplier.choosefailed', 'de', 'Der Dienst zum Setzen des Lieferanten war nicht erreichbar.'),
 ('viewer.supplier.close', 'de', 'Schließen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.supplier.find','viewer.supplier.findheading','viewer.supplier.searchhint','viewer.supplier.orleave','viewer.supplier.nomatches','viewer.supplier.searchfailed','viewer.supplier.choosefailed','viewer.supplier.close') == 16
