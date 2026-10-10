-- 0328_return_in_network_strings.sql
-- Decision 0724 — Return to supplier in the supplier network: the Returned
-- status, its Help line, and how a return is labelled in the conversation.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.status.returned', 'en', 'Returned'),
 ('network.status.returned', 'de', 'Zurückgesandt'),
 ('network.help.status.returned', 'en', 'The customer has sent this invoice back to you, with the reason. Correct it and send it again, or reply to ask.'),
 ('network.help.status.returned', 'de', 'Der Kunde hat Ihnen diese Rechnung mit Begründung zurückgesandt. Korrigieren und erneut senden, oder antworten Sie mit einer Frage.'),
 ('network.msg.returned', 'en', 'returned to you'),
 ('network.msg.returned', 'de', 'an Sie zurückgesandt'),
 ('supplierchat.returned', 'en', 'Returned to supplier'),
 ('supplierchat.returned', 'de', 'An Lieferanten zurückgesandt');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.status.returned', 'network.help.status.returned', 'network.msg.returned', 'supplierchat.returned') == 8
