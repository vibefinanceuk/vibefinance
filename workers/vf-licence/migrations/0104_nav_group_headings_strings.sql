-- 0104_nav_group_headings_strings.sql
-- Decision 0346 — grouping the side nav under headings.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('nav.group.accountspayable', 'en', 'Accounts payable'),
  ('nav.group.suppliermanagement', 'en', 'Supplier management'),
  ('nav.group.configuration', 'en', 'Configuration'),
  ('nav.group.accountspayable', 'de', 'Kreditorenbuchhaltung'),
  ('nav.group.suppliermanagement', 'de', 'Lieferantenverwaltung'),
  ('nav.group.configuration', 'de', 'Konfiguration');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('nav.group.accountspayable','nav.group.suppliermanagement','nav.group.configuration') AND locale = 'en' == 3
