-- 0184_ask_panel_strings.sql
-- Decision 0519. Ask gets its own button and side panel, apart from
-- Help. It adds three strings: the button, the panel's title, and a
-- one-line introduction. The question box, Ask button, "thinking",
-- failure and AI-disclaimer strings are reused from 0183's
-- `help.ask.*`.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('ask.button', 'en', 'Ask'),
 ('ask.title', 'en', 'Ask'),
 ('ask.intro', 'en', 'Ask anything about this page, or the invoice and task you have open. Answers come from the help for this page and the live facts of your task.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('ask.button', 'de', 'Fragen'),
 ('ask.title', 'de', 'Fragen'),
 ('ask.intro', 'de', 'Fragen Sie alles zu dieser Seite oder zur geöffneten Rechnung und Aufgabe. Antworten stützen sich auf die Hilfe zu dieser Seite und die aktuellen Fakten Ihrer Aufgabe.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('ask.button', 'ask.title', 'ask.intro') == 6
