-- 0060_buyer_card_strings.sql
-- Decision 0224 — the Buyer card, and re-routing.
--
-- **This one does not say "leave it."** A supplier that is not on file
-- may be genuinely new, and decision 0222's pop-out says so. An invoice
-- in no unit stops at the org gate (decision 0037), and one in the
-- wrong unit is handled wrongly by every stage after it — so the note
-- here explains why it matters instead.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.buyer.find', 'en', 'Choose the business unit'),
 ('viewer.buyer.change', 'en', 'Change business unit'),
 ('viewer.buyer.findheading', 'en', 'Which business unit is this for?'),
 ('viewer.buyer.searchhint', 'en', 'Unit name, company, VAT number or city'),
 ('viewer.buyer.why', 'en', 'Matching, coding and approval all follow this unit''s own configuration, so it needs to be right before validation is finished.'),
 ('viewer.buyer.none', 'en', 'This invoice has not been assigned to a business unit.'),
 ('viewer.buyer.no_identifier', 'en', 'The document gives no buyer VAT number, electronic address or reference, so it could not be placed automatically.'),
 ('viewer.buyer.no_match', 'en', 'No legal entity on file matches the buyer named on this document.'),
 ('viewer.buyer.ambiguous_unit', 'en', 'The buyer was recognised, but that company has several business units and the document does not say which.'),
 ('viewer.buyer.no_operating_unit', 'en', 'The buyer was recognised, but that company has no business unit to assign this to.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.buyer.find', 'de', 'Geschäftsbereich wählen'),
 ('viewer.buyer.change', 'de', 'Geschäftsbereich ändern'),
 ('viewer.buyer.findheading', 'de', 'Für welchen Geschäftsbereich ist das?'),
 ('viewer.buyer.searchhint', 'de', 'Bereichsname, Gesellschaft, USt-IdNr. oder Stadt'),
 ('viewer.buyer.why', 'de', 'Abgleich, Kontierung und Genehmigung folgen der Konfiguration dieses Bereichs, daher muss er vor Abschluss der Prüfung stimmen.'),
 ('viewer.buyer.none', 'de', 'Diese Rechnung wurde keinem Geschäftsbereich zugeordnet.'),
 ('viewer.buyer.no_identifier', 'de', 'Der Beleg nennt weder USt-IdNr. noch elektronische Adresse oder Referenz des Käufers, daher war keine automatische Zuordnung möglich.'),
 ('viewer.buyer.no_match', 'de', 'Keine hinterlegte Gesellschaft passt zu dem im Beleg genannten Käufer.'),
 ('viewer.buyer.ambiguous_unit', 'de', 'Der Käufer wurde erkannt, aber diese Gesellschaft hat mehrere Geschäftsbereiche und der Beleg nennt keinen.'),
 ('viewer.buyer.no_operating_unit', 'de', 'Der Käufer wurde erkannt, aber diese Gesellschaft hat keinen Geschäftsbereich, dem dies zugeordnet werden kann.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'viewer.buyer.%' == 20
