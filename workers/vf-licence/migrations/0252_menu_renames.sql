-- 0252_menu_renames.sql
-- Decision 0608. Dan, 2 October 2026: "Rename menu Access to Access
-- Control. Rename Rule menu to Process Rules." The screens' headings take
-- the same names, and the two AP Setup notes that name the Rules screen
-- follow.

UPDATE ui_strings SET value = 'Access Control' WHERE key = 'nav.access' AND locale = 'en';
UPDATE ui_strings SET value = 'Zugriffssteuerung' WHERE key = 'nav.access' AND locale = 'de';
UPDATE ui_strings SET value = 'Process Rules' WHERE key = 'nav.rules' AND locale = 'en';
UPDATE ui_strings SET value = 'Prozessregeln' WHERE key = 'nav.rules' AND locale = 'de';
UPDATE ui_strings SET value = replace(value, 'stage''s Rules screen', 'stage''s Process Rules screen') WHERE key IN ('apsetup.standardrulessub', 'apsetup.standardrulepending') AND locale = 'en';
UPDATE ui_strings SET value = replace(value, 'Regeln-Ansicht', 'Prozessregeln-Ansicht') WHERE key IN ('apsetup.standardrulessub', 'apsetup.standardrulepending') AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE (key = 'nav.access' AND value IN ('Access Control', 'Zugriffssteuerung')) OR (key = 'nav.rules' AND value IN ('Process Rules', 'Prozessregeln')) == 4
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.standardrulessub', 'apsetup.standardrulepending') AND (value LIKE '%Process Rules screen%' OR value LIKE '%Prozessregeln-Ansicht%') == 4
