-- 0247_connector_review_strings.sql
-- Decision 0600. What a partner sees when VibeFinance suspends its connector.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('submit.suspendedconnector', 'en', 'VibeFinance has suspended this connector: {reason}. New versions cannot be submitted until it is reinstated.'),
 ('submit.suspendedconnector', 'de', 'VibeFinance hat diesen Connector gesperrt: {reason}. Neue Versionen können erst nach der Freigabe eingereicht werden.'),
 ('httpsout.error.connector_suspended', 'en', 'VibeFinance has suspended this connector.'),
 ('httpsout.error.connector_suspended', 'de', 'VibeFinance hat diesen Connector gesperrt.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('submit.suspendedconnector','httpsout.error.connector_suspended') == 4
