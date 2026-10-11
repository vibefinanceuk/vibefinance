-- 0332_network_message_counts_strings.sql
-- Decision 0728 — the network's message counts: a Messages column on
-- Documents, and a count on the Documents menu item.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.col.messages', 'en', 'Messages'),
 ('network.col.messages', 'de', 'Nachrichten'),
 ('network.msg.new', 'en', '{n} new'),
 ('network.msg.new', 'de', '{n} neu'),
 ('network.msg.unreadtitle', 'en', 'Unread messages from {customer}'),
 ('network.msg.unreadtitle', 'de', 'Ungelesene Nachrichten von {customer}'),
 ('network.msg.readtitle', 'en', 'Messages, all read'),
 ('network.msg.readtitle', 'de', 'Nachrichten, alle gelesen'),
 ('network.nav.unread', 'en', '{n} invoices with unread messages'),
 ('network.nav.unread', 'de', '{n} Rechnungen mit ungelesenen Nachrichten');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.col.messages', 'network.msg.new', 'network.msg.unreadtitle', 'network.msg.readtitle', 'network.nav.unread') == 10
