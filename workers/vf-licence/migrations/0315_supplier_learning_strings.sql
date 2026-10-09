-- 0315_supplier_learning_strings.sql
-- Decision 0704 — whether learning a supplier's layout is helping: fields
-- corrected per invoice, on the supplier's page.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.learning.recent', 'en', 'Fields corrected per invoice: {recent} over the last {n} read ({earlier} before)'),
 ('suppliers.learning.recent', 'de', 'Korrigierte Felder je Rechnung: {recent} bei den letzten {n} gelesenen ({earlier} davor)'),
 ('suppliers.learning.recentonly', 'en', 'Fields corrected per invoice: {recent} over the last {n} read'),
 ('suppliers.learning.recentonly', 'de', 'Korrigierte Felder je Rechnung: {recent} bei den letzten {n} gelesenen'),
 ('suppliers.learning.helped', 'en', 'Read with what was learned: {helped} per invoice ({unhelped} without)'),
 ('suppliers.learning.helped', 'de', 'Mit dem Gelernten gelesen: {helped} je Rechnung ({unhelped} ohne)');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'suppliers.learning.%' == 6
