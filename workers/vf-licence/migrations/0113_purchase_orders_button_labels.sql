-- 0113_purchase_orders_button_labels.sql
-- Decision 0373 addendum — "Load CSV" and "CSV Template" rather than
-- the generic "Load"/"Download" every screen using actionLink's own
-- action.load / action.download shares. Kept separate from those
-- shared keys deliberately: action.load also labels Suppliers' own
-- load button, and that screen still wants the generic word.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.loadbutton', 'en', 'Load CSV'),
 ('purchaseorders.templatebutton', 'en', 'CSV Template');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.loadbutton', 'de', 'CSV laden'),
 ('purchaseorders.templatebutton', 'de', 'CSV-Vorlage');

-- Point-in-time: both keys exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('purchaseorders.loadbutton','purchaseorders.templatebutton') == 4
