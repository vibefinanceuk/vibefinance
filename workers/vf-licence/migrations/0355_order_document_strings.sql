-- 0355_order_document_strings.sql
-- Decision 0760 — a purchase order as a PDF, and its Document tab.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('orderdoc.tab', 'en', 'Document'),
 ('orderdoc.tab', 'de', 'Dokument'),
 ('orderdoc.title', 'en', 'Purchase order {order}'),
 ('orderdoc.title', 'de', 'Bestellung {order}'),
 ('orderdoc.loading', 'en', 'Loading the document…'),
 ('orderdoc.loading', 'de', 'Das Dokument wird geladen…'),
 ('orderdoc.failed', 'en', 'The document could not be shown.'),
 ('orderdoc.failed', 'de', 'Das Dokument konnte nicht angezeigt werden.'),
 ('orderdoc.pdf', 'en', 'PDF'),
 ('orderdoc.pdf', 'de', 'PDF'),
 ('orderdoc.ubl', 'en', 'UBL XML'),
 ('orderdoc.ubl', 'de', 'UBL-XML'),
 ('orderdoc.csv', 'en', 'CSV'),
 ('orderdoc.csv', 'de', 'CSV'),
 ('network.order.messagestab', 'en', 'Messages'),
 ('network.order.messagestab', 'de', 'Nachrichten'),
 ('ordersout.attachpdf', 'en', 'Attach the order as a PDF'),
 ('ordersout.attachpdf', 'de', 'Die Bestellung als PDF anhängen'),
 ('purchaseorders.tl.sent.pdf', 'en', 'With the order as a PDF.'),
 ('purchaseorders.tl.sent.pdf', 'de', 'Mit der Bestellung als PDF.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('orderdoc.tab', 'orderdoc.title', 'orderdoc.loading', 'orderdoc.failed', 'orderdoc.pdf', 'orderdoc.ubl', 'orderdoc.csv', 'network.order.messagestab', 'ordersout.attachpdf', 'purchaseorders.tl.sent.pdf') == 20
