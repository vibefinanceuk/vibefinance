-- 0111_purchase_orders_list_strings.sql
-- Decision 0372 — the purchase order list, and the detail pop-out a
-- clicked row opens. New keys only; 0110's own set is untouched, since
-- a landed migration is never edited, only added alongside.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.ordernumber', 'en', 'Order Number'),
 ('purchaseorders.issuedate', 'en', 'Issue Date'),
 ('purchaseorders.seller', 'en', 'Seller'),
 ('purchaseorders.buyer', 'en', 'Buyer'),
 ('purchaseorders.total', 'en', 'Total'),
 ('purchaseorders.lines', 'en', 'Lines'),
 ('purchaseorders.none', 'en', 'No purchase orders have been loaded yet.'),
 ('purchaseorders.failed', 'en', 'The purchase order list could not be loaded.'),
 ('purchaseorders.loading', 'en', 'Loading...'),
 ('purchaseorders.detailfailed', 'en', 'This purchase order could not be loaded.'),
 ('purchaseorders.ordertype', 'en', 'Order Type'),
 ('purchaseorders.currency', 'en', 'Currency'),
 ('purchaseorders.netamount', 'en', 'Net Amount'),
 ('purchaseorders.taxexclusive', 'en', 'Tax Exclusive'),
 ('purchaseorders.taxinclusive', 'en', 'Tax Inclusive'),
 ('purchaseorders.payable', 'en', 'Payable'),
 ('purchaseorders.requisition', 'en', 'Requisition Reference'),
 ('purchaseorders.line', 'en', 'Line'),
 ('purchaseorders.item', 'en', 'Item'),
 ('purchaseorders.description', 'en', 'Description'),
 ('purchaseorders.sku', 'en', "Seller's Item ID"),
 ('purchaseorders.standardid', 'en', 'Standard Item ID'),
 ('purchaseorders.quantity', 'en', 'Quantity'),
 ('purchaseorders.unit', 'en', 'Unit'),
 ('purchaseorders.price', 'en', 'Unit Price'),
 ('purchaseorders.amount', 'en', 'Amount');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.ordernumber', 'de', 'Bestellnummer'),
 ('purchaseorders.issuedate', 'de', 'Ausstellungsdatum'),
 ('purchaseorders.seller', 'de', 'Verkäufer'),
 ('purchaseorders.buyer', 'de', 'Käufer'),
 ('purchaseorders.total', 'de', 'Gesamt'),
 ('purchaseorders.lines', 'de', 'Positionen'),
 ('purchaseorders.none', 'de', 'Es wurden noch keine Bestellungen geladen.'),
 ('purchaseorders.failed', 'de', 'Die Bestellliste konnte nicht geladen werden.'),
 ('purchaseorders.loading', 'de', 'Wird geladen...'),
 ('purchaseorders.detailfailed', 'de', 'Diese Bestellung konnte nicht geladen werden.'),
 ('purchaseorders.ordertype', 'de', 'Bestellart'),
 ('purchaseorders.currency', 'de', 'Währung'),
 ('purchaseorders.netamount', 'de', 'Nettobetrag'),
 ('purchaseorders.taxexclusive', 'de', 'Ohne MwSt.'),
 ('purchaseorders.taxinclusive', 'de', 'Mit MwSt.'),
 ('purchaseorders.payable', 'de', 'Zahlbar'),
 ('purchaseorders.requisition', 'de', 'Anforderungsreferenz'),
 ('purchaseorders.line', 'de', 'Position'),
 ('purchaseorders.item', 'de', 'Artikel'),
 ('purchaseorders.description', 'de', 'Beschreibung'),
 ('purchaseorders.sku', 'de', 'Artikelnummer des Verkäufers'),
 ('purchaseorders.standardid', 'de', 'Standard-Artikelnummer'),
 ('purchaseorders.quantity', 'de', 'Menge'),
 ('purchaseorders.unit', 'de', 'Einheit'),
 ('purchaseorders.price', 'de', 'Stückpreis'),
 ('purchaseorders.amount', 'de', 'Betrag');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'purchaseorders.%' == 78
