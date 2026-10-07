-- 0302_receipt_conversations_strings.sql
-- Decision 0660 — the Conversations section of Tasks.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('receipts.conv.heading', 'en', 'Conversations'),
 ('receipts.conv.heading', 'de', 'Unterhaltungen'),
 ('receipts.conv.sub', 'en', 'Goods receipts you have been added to, and new messages in them. Open one to read and reply. Done takes it off this list until someone writes again.'),
 ('receipts.conv.sub', 'de', 'Wareneingänge, zu denen Sie hinzugefügt wurden, und neue Nachrichten darin. Öffnen Sie einen, um zu lesen und zu antworten. Erledigt nimmt ihn von der Liste, bis jemand wieder schreibt.'),
 ('receipts.conv.receipt', 'en', 'Goods receipt {number}'),
 ('receipts.conv.receipt', 'de', 'Wareneingang {number}'),
 ('receipts.conv.tag.added', 'en', 'Added to chat'),
 ('receipts.conv.tag.added', 'de', 'Zur Unterhaltung hinzugefügt'),
 ('receipts.conv.tag.new', 'en', 'New messages'),
 ('receipts.conv.tag.new', 'de', 'Neue Nachrichten'),
 ('receipts.conv.newcount', 'en', 'New messages: {n}'),
 ('receipts.conv.newcount', 'de', 'Neue Nachrichten: {n}'),
 ('receipts.conv.added', 'en', '{by} added you'),
 ('receipts.conv.added', 'de', '{by} hat Sie hinzugefügt'),
 ('receipts.conv.addedteam', 'en', '{by} added you (through the {team} team)'),
 ('receipts.conv.addedteam', 'de', '{by} hat Sie hinzugefügt (über das Team {team})'),
 ('receipts.conv.lastmessage', 'en', 'Last message {when}'),
 ('receipts.conv.lastmessage', 'de', 'Letzte Nachricht {when}'),
 ('receipts.conv.orders', 'en', 'PO {orders}'),
 ('receipts.conv.orders', 'de', 'Bestellung {orders}'),
 ('receipts.conv.quote', 'en', '{by}: “{body}”'),
 ('receipts.conv.quote', 'de', '{by}: „{body}“'),
 ('receipts.conv.open', 'en', 'Open'),
 ('receipts.conv.open', 'de', 'Öffnen'),
 ('receipts.conv.done', 'en', 'Done'),
 ('receipts.conv.done', 'de', 'Erledigt');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('receipts.conv.heading', 'receipts.conv.sub', 'receipts.conv.receipt', 'receipts.conv.tag.added', 'receipts.conv.tag.new', 'receipts.conv.newcount', 'receipts.conv.added', 'receipts.conv.addedteam', 'receipts.conv.lastmessage', 'receipts.conv.orders', 'receipts.conv.quote', 'receipts.conv.open', 'receipts.conv.done') == 26
