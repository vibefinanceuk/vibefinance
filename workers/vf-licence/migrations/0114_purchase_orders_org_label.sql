-- 0114_purchase_orders_org_label.sql
-- Decision 0374 — the resolved legal entity, shown alongside the raw
-- buyer tax reference in both the list and the detail pop-out.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.org', 'en', 'Org');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.org', 'de', 'Org.');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'purchaseorders.org' == 2
