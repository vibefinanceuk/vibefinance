-- 0110_purchase_orders_screen_strings.sql
-- Decision 0371 — the purchase order load screen.
--
-- A load screen, not a list screen (see purchase-orders.js's own
-- comment): there is no GET that returns every order on file, so
-- unlike Suppliers there are no column labels, no status names, no
-- "loaded N days ago" freshness line to seed here.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.purchaseorders', 'en', 'Purchase Orders'),
 ('purchaseorders.heading', 'en', 'Purchase Orders'),
 ('purchaseorders.subtitle', 'en', 'Loaded so invoices can be matched against them. Not itself a document anybody approves or processes.'),
 ('purchaseorders.loadheading', 'en', 'Load purchase orders'),
 ('purchaseorders.loadhelp', 'en', 'A CSV exported from your ERP, one row per order line. It needs an order number and a line number column.'),
 ('purchaseorders.nofile', 'en', 'Choose a file first.'),
 ('purchaseorders.loadfailed', 'en', 'We could not reach the service to load that file.'),
 ('purchaseorders.loadbroke', 'en', 'The file was loaded, but this screen could not show the result:'),
 ('purchaseorders.ordersloaded', 'en', '{n} purchase orders loaded.'),
 ('purchaseorders.ordersreplaced', 'en', '{n} of those replaced an order already on file.'),
 ('purchaseorders.linesloaded', 'en', '{n} order lines loaded.'),
 ('purchaseorders.refusedheading', 'en', 'Orders which could not be loaded'),
 ('purchaseorders.refusedorder', 'en', 'Order {order}: {reason}'),
 ('purchaseorders.refusedmore', 'en', 'and {n} more.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.purchaseorders', 'de', 'Bestellungen'),
 ('purchaseorders.heading', 'de', 'Bestellungen'),
 ('purchaseorders.subtitle', 'de', 'Geladen, damit Rechnungen damit abgeglichen werden können. Selbst kein Dokument, das jemand genehmigt oder bearbeitet.'),
 ('purchaseorders.loadheading', 'de', 'Bestellungen laden'),
 ('purchaseorders.loadhelp', 'de', 'Eine CSV-Datei aus Ihrem ERP, eine Zeile pro Bestellposition. Sie benötigt eine Bestellnummer- und eine Positionsnummer-Spalte.'),
 ('purchaseorders.nofile', 'de', 'Wählen Sie zuerst eine Datei.'),
 ('purchaseorders.loadfailed', 'de', 'Der Dienst zum Laden der Datei war nicht erreichbar.'),
 ('purchaseorders.loadbroke', 'de', 'Die Datei wurde geladen, aber dieser Bildschirm konnte das Ergebnis nicht anzeigen:'),
 ('purchaseorders.ordersloaded', 'de', '{n} Bestellungen geladen.'),
 ('purchaseorders.ordersreplaced', 'de', '{n} davon haben eine bereits vorhandene Bestellung ersetzt.'),
 ('purchaseorders.linesloaded', 'de', '{n} Bestellpositionen geladen.'),
 ('purchaseorders.refusedheading', 'de', 'Bestellungen, die nicht geladen werden konnten'),
 ('purchaseorders.refusedorder', 'de', 'Bestellung {order}: {reason}'),
 ('purchaseorders.refusedmore', 'de', 'und {n} weitere.');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'purchaseorders.%' OR key = 'nav.purchaseorders' == 28
