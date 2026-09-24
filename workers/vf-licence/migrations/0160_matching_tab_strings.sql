-- 0160_matching_tab_strings.sql
-- The Matching tab — decision 0472. AP Setup's own Matching tab stops
-- being a placeholder: the org-wide default tolerance and
-- quantity-matching toggle `org_matching_config` has held since
-- migration 0078 (decisions 0465/0468/0469) gets a real form,
-- `matching-config-route.ts`'s own front end.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.matchingsub', 'en', 'The org-wide default tolerance, used whenever a supplier has no tolerance of its own configured. Percentages are plain numbers — 5 means 5%.'),
 ('apsetup.amounttolerance', 'en', 'Amount tolerance (%)'),
 ('apsetup.quantitytolerance', 'en', 'Quantity tolerance (%)'),
 ('apsetup.quantitymatchingenabled', 'en', 'Compare quantity at all'),
 ('apsetup.savematchingfailed', 'en', 'Could not save the matching configuration');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.matchingsub', 'de', 'Die kundenweite Standardtoleranz, verwendet wenn für einen Lieferanten keine eigene Toleranz konfiguriert ist. Prozentsätze sind einfache Zahlen — 5 bedeutet 5%.'),
 ('apsetup.amounttolerance', 'de', 'Betragstoleranz (%)'),
 ('apsetup.quantitytolerance', 'de', 'Mengentoleranz (%)'),
 ('apsetup.quantitymatchingenabled', 'de', 'Menge überhaupt abgleichen'),
 ('apsetup.savematchingfailed', 'de', 'Abgleichskonfiguration konnte nicht gespeichert werden');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.matchingsub','apsetup.amounttolerance','apsetup.quantitytolerance','apsetup.quantitymatchingenabled','apsetup.savematchingfailed') == 10
