-- 0090_dashboard_heading_reword.sql
-- Decision 0307 — the Dashboard's own title and subtitle, reworded.
-- "Dashboard" replaces "My work"; the subtitle becomes a template with
-- a {name} placeholder, filled with the signed-in person's own name at
-- render time, the same {n}/{days}-style placeholder convention
-- suppliers.loaded and suppliers.loadedago already use.
UPDATE ui_strings SET value = 'Dashboard' WHERE key = 'dash.heading' AND locale = 'en';
UPDATE ui_strings SET value = 'Dashboard' WHERE key = 'dash.heading' AND locale = 'de';
UPDATE ui_strings SET value = 'Items pending for my user - {name}' WHERE key = 'dash.sub' AND locale = 'en';
UPDATE ui_strings SET value = 'Ausstehende Elemente für meinen Benutzer - {name}' WHERE key = 'dash.sub' AND locale = 'de';

-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.heading' AND locale = 'en' == 'Dashboard'
-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.sub' AND locale = 'en' == 'Items pending for my user - {name}'
