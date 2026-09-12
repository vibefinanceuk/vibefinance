-- 0080_system_alert_label.sql
--
-- Decision 0272 — the unreadable-document note restyled as a System
-- Alert card, matching the look of the mock-up shown for the Alerts
-- tab, minus the warning colour: "it does not need to be highlighted
-- in Orange. But it should be consistent with any other system
-- alert." The first real instance of a card shape meant to be reused
-- once the Alerts tab itself is built.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.systemalert', 'en', 'System Alert');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.systemalert', 'de', 'Systemhinweis');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'activity.systemalert' == 2
