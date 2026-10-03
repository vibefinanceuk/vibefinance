-- 0262_open_supplier_strings.sql
-- Decision 0619. Opening one supplier from elsewhere (Fraud Prevention's
-- lists first).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.opensupplier', 'en', 'Open this supplier'),
 ('fraudprevention.opensupplier', 'de', 'Diesen Lieferanten öffnen'),
 ('suppliers.notvisible', 'en', '{name} is not among the suppliers you can see for the organisation chosen'),
 ('suppliers.notvisible', 'de', '{name} gehört nicht zu den Lieferanten, die Sie für die gewählte Organisation sehen können');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('fraudprevention.opensupplier','suppliers.notvisible') == 4
