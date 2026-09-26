-- 0179_account_coding_validity_strings.sql
-- Decision 0511 — coding values checked against Account Coding's own
-- lists.
--
-- Five new strings: the new `account_coding` validation check's own
-- label (the same `check.<name>` convention `check.po_mismatch`,
-- migration 0124, set — it is the tooltip on a line's marked Coding
-- button), the heading of a refused coding save, and one phrase per
-- reason the save route can give (`not_on_list`, `wrong_company`,
-- `wrong_commodity`), which `viewer.js`'s `codingRefusalText` reads
-- rather than the route's own English sentence.
--
-- Written without `;` inside any value — `test/setup.ts`'s statement
-- splitter is blind to quoted literals (decision 0445).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('check.account_coding', 'en', 'Not on the Account Coding lists'),
 ('viewer.coding.invalid', 'en', 'Not saved. These coding values are not on the Account Coding lists:'),
 ('viewer.coding.invalid.not_on_list', 'en', 'is not on the list'),
 ('viewer.coding.invalid.wrong_company', 'en', 'does not belong to this invoice''s company code'),
 ('viewer.coding.invalid.wrong_commodity', 'en', 'is not linked to the line''s Commodity Code');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('check.account_coding', 'de', 'Nicht in den Kontierungslisten'),
 ('viewer.coding.invalid', 'de', 'Nicht gespeichert. Diese Kontierungswerte fehlen in den Kontierungslisten:'),
 ('viewer.coding.invalid.not_on_list', 'de', 'ist nicht in der Liste'),
 ('viewer.coding.invalid.wrong_company', 'de', 'gehört nicht zum Buchungskreis dieser Rechnung'),
 ('viewer.coding.invalid.wrong_commodity', 'de', 'ist nicht mit der Warengruppe der Position verknüpft');

-- Point-in-time: all five new keys exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('check.account_coding', 'viewer.coding.invalid', 'viewer.coding.invalid.not_on_list', 'viewer.coding.invalid.wrong_company', 'viewer.coding.invalid.wrong_commodity') == 10
