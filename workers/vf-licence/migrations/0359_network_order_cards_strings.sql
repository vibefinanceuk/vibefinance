-- 0359_network_order_cards_strings.sql
-- Decision 0765 — the supplier network's order laid out as an invoice is: Seller, Buyer, Progress, the order's header and its lines.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.order.header', 'en', 'Purchase order header'),
 ('network.order.header', 'de', 'Bestellkopf'),
 ('network.order.linestitle', 'en', 'Purchase order lines'),
 ('network.order.linestitle', 'de', 'Bestellpositionen'),
 ('network.order.number', 'en', 'Order number'),
 ('network.order.number', 'de', 'Bestellnummer'),
 ('network.order.requisition', 'en', 'Requisition'),
 ('network.order.requisition', 'de', 'Bedarfsanforderung'),
 ('network.order.email', 'en', 'Orders email'),
 ('network.order.email', 'de', 'E-Mail für Bestellungen'),
 ('network.order.contact', 'en', 'Contact'),
 ('network.order.contact', 'de', 'Ansprechpartner'),
 ('network.order.progress', 'en', 'Progress'),
 ('network.order.progress', 'de', 'Stand'),
 ('network.order.confirmedfield', 'en', 'Confirmed'),
 ('network.order.confirmedfield', 'de', 'Bestätigt'),
 ('network.order.notyet', 'en', 'Not yet'),
 ('network.order.notyet', 'de', 'Noch nicht');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.order.header', 'network.order.linestitle', 'network.order.number', 'network.order.requisition', 'network.order.email', 'network.order.contact', 'network.order.progress', 'network.order.confirmedfield', 'network.order.notyet') == 18
