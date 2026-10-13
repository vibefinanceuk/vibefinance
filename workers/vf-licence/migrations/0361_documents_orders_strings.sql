-- 0361_documents_orders_strings.sql
-- Decision 0769 — purchase orders on the Documents screen, their statuses in the supplier network's words.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.type.purchase_order', 'en', 'Purchase orders'),
 ('documents.type.purchase_order', 'de', 'Bestellungen'),
 ('docstatus.order_open', 'en', 'Open'),
 ('docstatus.order_open', 'de', 'Offen'),
 ('docstatus.order_part_received', 'en', 'Part received'),
 ('docstatus.order_part_received', 'de', 'Teilweise geliefert'),
 ('docstatus.order_received', 'en', 'Received'),
 ('docstatus.order_received', 'de', 'Geliefert'),
 ('docstatus.order_part_invoiced', 'en', 'Part invoiced'),
 ('docstatus.order_part_invoiced', 'de', 'Teilweise berechnet'),
 ('docstatus.order_invoiced', 'en', 'Invoiced'),
 ('docstatus.order_invoiced', 'de', 'Berechnet'),
 ('docstatus.order_on_hold', 'en', 'On hold'),
 ('docstatus.order_on_hold', 'de', 'Gesperrt'),
 ('docstatus.order_closed', 'en', 'Closed'),
 ('docstatus.order_closed', 'de', 'Abgeschlossen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('documents.type.purchase_order', 'docstatus.order_open', 'docstatus.order_part_received', 'docstatus.order_received', 'docstatus.order_part_invoiced', 'docstatus.order_invoiced', 'docstatus.order_on_hold', 'docstatus.order_closed') == 16
