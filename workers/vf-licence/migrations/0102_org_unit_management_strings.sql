-- 0102_org_unit_management_strings.sql
-- Decision 0335 — "a Create org and manage org button."
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.neworg', 'en', 'New org'),
  ('roles.orgid', 'en', 'Org ID'),
  ('roles.orgname', 'en', 'Name'),
  ('roles.parentorg', 'en', 'Parent org'),
  ('roles.buyerendpoint', 'en', 'Buyer endpoint'),
  ('roles.vatid', 'en', 'VAT ID'),
  ('roles.buyerreference', 'en', 'Buyer reference'),
  ('roles.orgsavefailed', 'en', 'Could not save. Please try again.'),
  ('roles.operatingunit', 'en', 'Operating unit'),
  ('roles.legalentity', 'en', 'Legal entity'),
  ('action.neworg', 'de', 'Neue Organisation'),
  ('roles.orgid', 'de', 'Org-ID'),
  ('roles.orgname', 'de', 'Name'),
  ('roles.parentorg', 'de', 'Übergeordnete Organisation'),
  ('roles.buyerendpoint', 'de', 'Käufer-Endpunkt'),
  ('roles.vatid', 'de', 'USt-IdNr.'),
  ('roles.buyerreference', 'de', 'Käuferreferenz'),
  ('roles.orgsavefailed', 'de', 'Konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.'),
  ('roles.operatingunit', 'de', 'Betriebseinheit'),
  ('roles.legalentity', 'de', 'Rechtsträger');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.neworg','roles.orgid','roles.orgname','roles.parentorg','roles.buyerendpoint','roles.vatid','roles.buyerreference','roles.orgsavefailed','roles.operatingunit','roles.legalentity') AND locale = 'en' == 10
