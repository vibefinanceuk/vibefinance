-- 0305_inbound_read_later_strings.sql
-- Decision 0687 — an emailed message is accepted at once and read
-- afterwards; the same email delivered twice is read once. The Route
-- monitor's words for the four new events.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('routemonitor.event.queued', 'en', 'Accepted, waiting to be read'),
 ('routemonitor.event.queued', 'de', 'Angenommen, wartet auf Lesen'),
 ('routemonitor.event.received_again', 'en', 'Same email received again, not read again'),
 ('routemonitor.event.received_again', 'de', 'Dieselbe E-Mail erneut erhalten, nicht erneut gelesen'),
 ('routemonitor.event.read_resumed', 'en', 'Reading resumed'),
 ('routemonitor.event.read_resumed', 'de', 'Lesen fortgesetzt'),
 ('routemonitor.event.read_given_up', 'en', 'Reading given up'),
 ('routemonitor.event.read_given_up', 'de', 'Lesen aufgegeben');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('routemonitor.event.queued','routemonitor.event.received_again','routemonitor.event.read_resumed','routemonitor.event.read_given_up') == 8
