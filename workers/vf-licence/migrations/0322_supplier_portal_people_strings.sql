-- 0322_supplier_portal_people_strings.sql
-- Decision 0715 — the supplier portal on a supplier's page: who may see the
-- supplier's invoices, for which companies, and inviting someone new.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.portal.title', 'en', 'Supplier portal'),
 ('suppliers.portal.title', 'de', 'Lieferantenportal'),
 ('suppliers.portal.none', 'en', 'Nobody from this supplier uses the portal yet.'),
 ('suppliers.portal.none', 'de', 'Von diesem Lieferanten nutzt noch niemand das Portal.'),
 ('suppliers.portal.companies', 'en', 'For: {companies}'),
 ('suppliers.portal.companies', 'de', 'Für: {companies}'),
 ('suppliers.portal.invited', 'en', 'Invited, until {date}'),
 ('suppliers.portal.invited', 'de', 'Eingeladen, bis {date}'),
 ('suppliers.portal.expired', 'en', 'Invitation expired'),
 ('suppliers.portal.expired', 'de', 'Einladung abgelaufen'),
 ('suppliers.portal.spent', 'en', 'Invitation used up by wrong codes'),
 ('suppliers.portal.spent', 'de', 'Einladung durch falsche Codes verbraucht'),
 ('suppliers.portal.end', 'en', 'End access'),
 ('suppliers.portal.end', 'de', 'Zugang beenden'),
 ('suppliers.portal.cancel', 'en', 'Cancel invitation'),
 ('suppliers.portal.cancel', 'de', 'Einladung zurückziehen'),
 ('suppliers.portal.email', 'en', 'Email address'),
 ('suppliers.portal.email', 'de', 'E-Mail-Adresse'),
 ('suppliers.portal.invite', 'en', 'Invite to portal'),
 ('suppliers.portal.invite', 'de', 'Zum Portal einladen'),
 ('suppliers.portal.choose', 'en', 'Choose at least one company.'),
 ('suppliers.portal.choose', 'de', 'Wählen Sie mindestens ein Unternehmen.'),
 ('suppliers.portal.sent', 'en', 'Invitation sent to {email}.'),
 ('suppliers.portal.sent', 'de', 'Einladung an {email} gesendet.'),
 ('suppliers.portal.notsent', 'en', 'Invitation made, but the email could not be sent: {error}'),
 ('suppliers.portal.notsent', 'de', 'Einladung erstellt, aber die E-Mail konnte nicht gesendet werden: {error}'),
 ('suppliers.portal.help', 'en', 'They see this supplier''s invoices for the companies chosen, and the units beneath them: where each is, and when it is sent for payment. Inviting them again replaces the companies.'),
 ('suppliers.portal.help', 'de', 'Sie sehen die Rechnungen dieses Lieferanten für die gewählten Unternehmen und die Einheiten darunter: wo jede steht und wann sie zur Zahlung übergeben wird. Eine erneute Einladung ersetzt die Unternehmen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'suppliers.portal.%' == 28
