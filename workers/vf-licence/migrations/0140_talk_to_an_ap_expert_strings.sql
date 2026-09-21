-- 0140_talk_to_an_ap_expert_strings.sql
--
-- Decision 0430 — Screen 6, "Talk to an AP Expert," the sixth and last
-- tab on the AP Analytics screen, Phase 5 of the design's own
-- Recommended Phasing.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apanalytics.assistant', 'en', 'Talk to an AP Expert'),
 ('apassistant.heading', 'en', 'Talk to an AP Expert'),
 ('apassistant.sub', 'en', 'Ask a plain question about supplier spend, overdue balances, accruals, or exceptions'),
 ('apassistant.empty', 'en', 'Ask a question to get started — for example, "how much have we spent with Acme?"'),
 ('apassistant.thinking', 'en', 'Thinking…'),
 ('apassistant.placeholder', 'en', 'Ask a question…'),
 ('apassistant.send', 'en', 'Ask'),
 ('apassistant.error', 'en', 'Something went wrong answering that — please try again.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apanalytics.assistant', 'de', 'Mit einem KI-Experten sprechen'),
 ('apassistant.heading', 'de', 'Mit einem KI-Experten sprechen'),
 ('apassistant.sub', 'de', 'Stellen Sie eine einfache Frage zu Lieferantenausgaben, überfälligen Salden, Abgrenzungen oder Ausnahmen'),
 ('apassistant.empty', 'de', 'Stellen Sie eine Frage, um zu beginnen — zum Beispiel: „Wie viel haben wir bei Acme ausgegeben?“'),
 ('apassistant.thinking', 'de', 'Denke nach…'),
 ('apassistant.placeholder', 'de', 'Frage stellen…'),
 ('apassistant.send', 'de', 'Fragen'),
 ('apassistant.error', 'de', 'Bei der Beantwortung ist etwas schiefgelaufen — bitte versuchen Sie es erneut.');

-- Point-in-time: every key above exists in both locales, nothing more.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apanalytics.assistant','apassistant.heading','apassistant.sub','apassistant.empty','apassistant.thinking','apassistant.placeholder','apassistant.send','apassistant.error') == 16
