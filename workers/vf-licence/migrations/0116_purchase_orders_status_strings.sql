-- 0116_purchase_orders_status_strings.sql
-- Decision 0377 — the status chart, and Hold/Release Hold/Close on
-- the detail pop-out. action.hold, action.releasehold, and
-- action.close already exist (migration 0065) and are reused as-is —
-- these are the screen-specific strings on top of them.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.statusheading', 'en', 'Status'),
 ('purchaseorders.statuslabel', 'en', 'Status'),
 ('purchaseorders.status.active', 'en', 'Active'),
 ('purchaseorders.status.onhold', 'en', 'On Hold'),
 ('purchaseorders.status.closed', 'en', 'Closed'),
 ('purchaseorders.status.invoicedpart', 'en', 'Invoiced (Part)'),
 ('purchaseorders.status.invoicedfull', 'en', 'Invoiced (Full)'),
 ('purchaseorders.hold', 'en', 'Hold'),
 ('purchaseorders.holdreason', 'en', 'Why is this order on hold?'),
 ('purchaseorders.holdreasonhint', 'en', 'Reason for the hold'),
 ('purchaseorders.holdconfirm', 'en', 'Confirm hold'),
 ('purchaseorders.closeorder', 'en', 'Close Order'),
 ('purchaseorders.closeconfirm', 'en', 'Close this order permanently? This cannot be undone.'),
 ('purchaseorders.statuschangefailed', 'en', 'Could not change the order''s status.'),
 ('purchaseorders.nostatusdata', 'en', 'No status data to show yet.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.statusheading', 'de', 'Status'),
 ('purchaseorders.statuslabel', 'de', 'Status'),
 ('purchaseorders.status.active', 'de', 'Aktiv'),
 ('purchaseorders.status.onhold', 'de', 'Gesperrt'),
 ('purchaseorders.status.closed', 'de', 'Geschlossen'),
 ('purchaseorders.status.invoicedpart', 'de', 'Teilweise fakturiert'),
 ('purchaseorders.status.invoicedfull', 'de', 'Vollständig fakturiert'),
 ('purchaseorders.hold', 'de', 'Gesperrt'),
 ('purchaseorders.holdreason', 'de', 'Warum wird diese Bestellung gesperrt?'),
 ('purchaseorders.holdreasonhint', 'de', 'Grund für die Sperrung'),
 ('purchaseorders.holdconfirm', 'de', 'Sperrung bestätigen'),
 ('purchaseorders.closeorder', 'de', 'Bestellung schließen'),
 ('purchaseorders.closeconfirm', 'de', 'Diese Bestellung dauerhaft schließen? Dies kann nicht rückgängig gemacht werden.'),
 ('purchaseorders.statuschangefailed', 'de', 'Der Status der Bestellung konnte nicht geändert werden.'),
 ('purchaseorders.nostatusdata', 'de', 'Noch keine Statusdaten vorhanden.');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('purchaseorders.statusheading','purchaseorders.statuslabel','purchaseorders.status.active','purchaseorders.status.onhold','purchaseorders.status.closed','purchaseorders.status.invoicedpart','purchaseorders.status.invoicedfull','purchaseorders.hold','purchaseorders.holdreason','purchaseorders.holdreasonhint','purchaseorders.holdconfirm','purchaseorders.closeorder','purchaseorders.closeconfirm','purchaseorders.statuschangefailed','purchaseorders.nostatusdata') == 30
