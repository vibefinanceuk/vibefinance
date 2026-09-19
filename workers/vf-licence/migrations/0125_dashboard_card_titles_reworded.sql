-- 0125_dashboard_card_titles_reworded.sql
-- The operator's own direct request: reword six of the Dashboard's own
-- card titles, and drop "On my clock"'s explanatory subtitle
-- (dash.myclocksub) entirely — that removal is a JS/markup change
-- (dashboard.js no longer renders it), not a string change, so this
-- migration does not touch that row; it is simply never read again.
--
-- Same UPDATE-in-place pattern decision 0307 (0090) used for the
-- heading/subtitle rename — these keys stay the same, only the wording
-- changes, so nothing else that reads dash.waiting_for_me,
-- dash.on_my_clock, dash.where_things_are, dash.ageing, dash.done, or
-- dash.suppliers_awaiting_erp needs to change with it.
UPDATE ui_strings SET value = 'My Tasks by Stage' WHERE key = 'dash.waiting_for_me' AND locale = 'en';
UPDATE ui_strings SET value = 'All Open Tasks by Stage' WHERE key = 'dash.where_things_are' AND locale = 'en';
UPDATE ui_strings SET value = 'Task Aging Report' WHERE key = 'dash.ageing' AND locale = 'en';
UPDATE ui_strings SET value = 'My Priority Tasks' WHERE key = 'dash.on_my_clock' AND locale = 'en';
UPDATE ui_strings SET value = 'Supplier Setup Required' WHERE key = 'dash.suppliers_awaiting_erp' AND locale = 'en';
UPDATE ui_strings SET value = 'Tasks Completed This Week' WHERE key = 'dash.done' AND locale = 'en';

UPDATE ui_strings SET value = 'Meine Aufgaben nach Phase' WHERE key = 'dash.waiting_for_me' AND locale = 'de';
UPDATE ui_strings SET value = 'Alle offenen Aufgaben nach Phase' WHERE key = 'dash.where_things_are' AND locale = 'de';
UPDATE ui_strings SET value = 'Aufgaben-Alterungsbericht' WHERE key = 'dash.ageing' AND locale = 'de';
UPDATE ui_strings SET value = 'Meine vorrangigen Aufgaben' WHERE key = 'dash.on_my_clock' AND locale = 'de';
UPDATE ui_strings SET value = 'Lieferanteneinrichtung erforderlich' WHERE key = 'dash.suppliers_awaiting_erp' AND locale = 'de';
UPDATE ui_strings SET value = 'Diese Woche erledigte Aufgaben' WHERE key = 'dash.done' AND locale = 'de';

-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.waiting_for_me' AND locale = 'en' == 'My Tasks by Stage'
-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.where_things_are' AND locale = 'en' == 'All Open Tasks by Stage'
-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.ageing' AND locale = 'en' == 'Task Aging Report'
-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.on_my_clock' AND locale = 'en' == 'My Priority Tasks'
-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.suppliers_awaiting_erp' AND locale = 'en' == 'Supplier Setup Required'
-- ASSERT: SELECT value FROM ui_strings WHERE key = 'dash.done' AND locale = 'en' == 'Tasks Completed This Week'
