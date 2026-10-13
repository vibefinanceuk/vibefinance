-- 0351_order_page_strings.sql
-- Decision 0753 — a purchase order opened as a page, the conversation on the right.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.supplierchat.none', 'en', 'No conversation with the supplier yet. It opens once the order is shared in the Supplier Network and someone at the supplier is linked.'),
 ('purchaseorders.supplierchat.none', 'de', 'Noch keine Unterhaltung mit dem Lieferanten. Sie ist möglich, sobald die Bestellung im Lieferantennetzwerk geteilt ist und jemand beim Lieferanten verknüpft ist.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('purchaseorders.supplierchat.none') == 2
