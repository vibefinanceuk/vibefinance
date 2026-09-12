-- 0083_nav_restructure.sql
--
-- Decision 0274 — the operator's own nav restructuring: "My work"
-- renamed "Dashboard" and moved first; a new collapsible "Vibe AP"
-- group holding Tasks, Sources, Suppliers, Rules and Documents; the
-- whole nav made collapsible to icons only.
UPDATE ui_strings SET value = 'Dashboard' WHERE key = 'nav.dashboard' AND locale = 'en';
UPDATE ui_strings SET value = 'Dashboard' WHERE key = 'nav.dashboard' AND locale = 'de';

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.vibeap', 'en', 'Vibe AP'),
 ('nav.collapse', 'en', 'Collapse the menu'),
 ('nav.expand', 'en', 'Expand the menu');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.vibeap', 'de', 'Vibe AP'),
 ('nav.collapse', 'de', 'Menü einklappen'),
 ('nav.expand', 'de', 'Menü ausklappen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('nav.vibeap','nav.collapse','nav.expand') == 6
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'nav.dashboard' AND value = 'My work' == 0
