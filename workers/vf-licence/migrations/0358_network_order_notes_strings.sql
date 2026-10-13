-- 0358_network_order_notes_strings.sql
-- Decision 0764 — the supplier network's order: waiting to be confirmed as an alert, and what happened as dated lines in Messages.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.order.todo', 'en', 'To do:'),
 ('network.order.todo', 'de', 'Zu erledigen:'),
 ('network.order.confirmednote.order', 'en', 'You confirmed receipt of this order.'),
 ('network.order.confirmednote.order', 'de', 'Sie haben den Empfang dieser Bestellung bestätigt.'),
 ('network.order.confirmednote.change', 'en', 'You confirmed receipt of this change.'),
 ('network.order.confirmednote.change', 'de', 'Sie haben den Empfang dieser Änderung bestätigt.'),
 ('network.order.confirmednote.cancellation', 'en', 'You confirmed receipt of this cancellation.'),
 ('network.order.confirmednote.cancellation', 'de', 'Sie haben den Empfang dieser Stornierung bestätigt.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.order.todo', 'network.order.confirmednote.order', 'network.order.confirmednote.change', 'network.order.confirmednote.cancellation') == 8
