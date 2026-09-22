-- 0146_ap_setup_override_search_strings.sql
--
-- Decision 0442 — the two override lists on AP Setup's own Approval
-- Hierarchy tab, reordered below their add-row forms and made
-- searchable, at the operator's own request once they started to grow:
-- "list the Supervisor Overrides, and Approval Limit Overrides entries
-- below the prompt boxes... make the list searchable and paginated, as
-- the Document search looks." Documents' own "search" turned out to be
-- a query box plus a capped result set with a "shown of total" note,
-- not real page-number controls (this app has none anywhere) — matched
-- here rather than invented fresh.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.supervisoroverridesearchhint', 'en', 'Person, org, or supervisor'),
 ('apsetup.supervisoroverridenomatch', 'en', 'Nothing matches that. Try a person, org, or supervisor name.'),
 ('apsetup.limitoverridesearchhint', 'en', 'Person, org, or currency'),
 ('apsetup.limitoverridenomatch', 'en', 'Nothing matches that. Try a person, org, or currency.'),
 ('apsetup.overridesearchedcount', 'en', '{shown} of {total} matching.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.supervisoroverridesearchhint', 'de', 'Person, Organisation oder Vorgesetzter'),
 ('apsetup.supervisoroverridenomatch', 'de', 'Dazu passt nichts. Versuchen Sie eine Person, Organisation oder einen Vorgesetzten.'),
 ('apsetup.limitoverridesearchhint', 'de', 'Person, Organisation oder Währung'),
 ('apsetup.limitoverridenomatch', 'de', 'Dazu passt nichts. Versuchen Sie eine Person, Organisation oder Währung.'),
 ('apsetup.overridesearchedcount', 'de', '{shown} von {total} passenden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.supervisoroverridesearchhint','apsetup.supervisoroverridenomatch','apsetup.limitoverridesearchhint','apsetup.limitoverridenomatch','apsetup.overridesearchedcount') == 10
