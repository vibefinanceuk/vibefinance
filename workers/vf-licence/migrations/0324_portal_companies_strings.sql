-- 0324_portal_companies_strings.sql
-- Decision 0718 — changing a linked person's companies in place, choosing
-- among many companies, and saying which companies an empty supplier network
-- list covers.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.portal.more', 'en', '+ {n} more'),
 ('suppliers.portal.more', 'de', '+ {n} weitere'),
 ('suppliers.portal.chosen', 'en', '{n} of {total} chosen'),
 ('suppliers.portal.chosen', 'de', '{n} von {total} gewählt'),
 ('suppliers.portal.findcompany', 'en', 'Find a company'),
 ('suppliers.portal.findcompany', 'de', 'Unternehmen suchen'),
 ('suppliers.portal.selectall', 'en', 'Select all shown'),
 ('suppliers.portal.selectall', 'de', 'Alle angezeigten wählen'),
 ('suppliers.portal.clear', 'en', 'Clear'),
 ('suppliers.portal.clear', 'de', 'Leeren'),
 ('suppliers.portal.change', 'en', 'Change companies'),
 ('suppliers.portal.change', 'de', 'Unternehmen ändern'),
 ('suppliers.portal.save', 'en', 'Save'),
 ('suppliers.portal.save', 'de', 'Speichern'),
 ('suppliers.portal.cancelchange', 'en', 'Cancel'),
 ('suppliers.portal.cancelchange', 'de', 'Abbrechen'),
 ('suppliers.portal.changed', 'en', 'Companies changed for {email}.'),
 ('suppliers.portal.changed', 'de', 'Unternehmen für {email} geändert.'),
 ('network.nomatch', 'en', 'No invoices match your search.'),
 ('network.nomatch', 'de', 'Keine Rechnungen entsprechen Ihrer Suche.'),
 ('network.noneyet', 'en', 'No invoices yet for the companies you can see: {list}'),
 ('network.noneyet', 'de', 'Noch keine Rechnungen für die Unternehmen, die Sie sehen können: {list}'),
 ('network.companies.count', 'en', '{n} companies'),
 ('network.companies.count', 'de', '{n} Unternehmen');

-- Changing companies has its own control now, so the help no longer says to invite again.
UPDATE ui_strings SET value = 'They see this supplier''s invoices for the companies chosen, and the units beneath them: where each is, and when it is sent for payment.'
 WHERE key = 'suppliers.portal.help' AND locale = 'en';
UPDATE ui_strings SET value = 'Sie sehen die Rechnungen dieses Lieferanten für die gewählten Unternehmen und die Einheiten darunter: wo jede steht und wann sie zur Zahlung übergeben wird.'
 WHERE key = 'suppliers.portal.help' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.portal.more','suppliers.portal.chosen','suppliers.portal.findcompany','suppliers.portal.selectall','suppliers.portal.clear','suppliers.portal.change','suppliers.portal.save','suppliers.portal.cancelchange','suppliers.portal.changed','network.nomatch','network.noneyet','network.companies.count') == 24
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.portal.help' AND value LIKE '%again%' == 0
