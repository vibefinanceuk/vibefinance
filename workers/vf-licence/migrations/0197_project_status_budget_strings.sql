-- 0197_project_status_budget_strings.sql
-- Decision 0542. A project's status and budget in AP Setup, a closed
-- project refused on a line, and the Coding pop-out's budget bar.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.codingstatus', 'en', 'Status'),
 ('apsetup.codingstatus.active', 'en', 'Active'),
 ('apsetup.codingstatus.closed', 'en', 'Closed'),
 ('apsetup.codingbudget', 'en', 'Budget'),
 ('viewer.coding.invalid.closed', 'en', 'is closed'),
 ('viewer.coding.budget', 'en', 'Budget {budget} · other invoices {others} · this invoice {mine} · left {left}'),
 ('viewer.coding.overbudget', 'en', 'Over budget by {amount}');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.codingstatus', 'de', 'Status'),
 ('apsetup.codingstatus.active', 'de', 'Aktiv'),
 ('apsetup.codingstatus.closed', 'de', 'Abgeschlossen'),
 ('apsetup.codingbudget', 'de', 'Budget'),
 ('viewer.coding.invalid.closed', 'de', 'ist abgeschlossen'),
 ('viewer.coding.budget', 'de', 'Budget {budget} · andere Rechnungen {others} · diese Rechnung {mine} · verbleibend {left}'),
 ('viewer.coding.overbudget', 'de', 'Budget überschritten um {amount}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.codingstatus', 'apsetup.codingstatus.active', 'apsetup.codingstatus.closed', 'apsetup.codingbudget', 'viewer.coding.invalid.closed', 'viewer.coding.budget', 'viewer.coding.overbudget') == 14
