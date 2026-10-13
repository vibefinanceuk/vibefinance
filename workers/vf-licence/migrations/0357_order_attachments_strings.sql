-- 0357_order_attachments_strings.sql
-- Decision 0763 — a purchase order's PDF, UBL XML and CSV on an Attachments tab, as other files are.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('orderdoc.attachhead', 'en', 'The order as the supplier gets it'),
 ('orderdoc.attachhead', 'de', 'Die Bestellung, wie der Lieferant sie erhält'),
 ('network.order.attachtab', 'en', 'Attachments'),
 ('network.order.attachtab', 'de', 'Anhänge'),
 ('network.order.attachhead', 'en', 'The order as {customer} sends it'),
 ('network.order.attachhead', 'de', 'Die Bestellung, wie {customer} sie sendet');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('orderdoc.attachhead', 'network.order.attachtab', 'network.order.attachhead') == 6
