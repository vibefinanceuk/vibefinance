-- 0187_nav_group_short_headings.sql
-- Decision 0525. The folded side menu's own group headings, in the
-- operator's own words: "include some abbreviated separators in when
-- retracted. This would be AP, SM, CONF, AR and EXP."
--
-- Accounts receivable and Expenses have no screens yet, so no heading
-- uses their short forms today. They are added now so those groups
-- show AR and EXP the day their first screen lands.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.groupshort.accountspayable', 'en', 'AP'),
 ('nav.groupshort.suppliermanagement', 'en', 'SM'),
 ('nav.groupshort.configuration', 'en', 'CONF'),
 ('nav.groupshort.accountsreceivable', 'en', 'AR'),
 ('nav.groupshort.expenses', 'en', 'EXP');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.groupshort.accountspayable', 'de', 'KRED'),
 ('nav.groupshort.suppliermanagement', 'de', 'LV'),
 ('nav.groupshort.configuration', 'de', 'KONF'),
 ('nav.groupshort.accountsreceivable', 'de', 'DEB'),
 ('nav.groupshort.expenses', 'de', 'SPES');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'nav.groupshort.%' == 10
