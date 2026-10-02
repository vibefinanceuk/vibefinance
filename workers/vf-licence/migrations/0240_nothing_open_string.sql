-- 0240_nothing_open_string.sql
-- Decision 0594. What a person signed in with no screen open to them is told,
-- in place of a blank page.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('tasks.nothingopen', 'en', 'Nothing here is open to you yet. Ask an administrator to give you a role.'),
 ('tasks.nothingopen', 'de', 'Hier ist für Sie noch nichts freigegeben. Bitten Sie eine Administratorin oder einen Administrator um eine Rolle.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('tasks.nothingopen') == 2
