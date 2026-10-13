-- 0353_invoice_order_strings.sql
-- Decision 0755 — Invoice this order, in the supplier network.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.invoiceorder', 'en', 'Invoice this order'),
 ('network.invoiceorder', 'de', 'Diese Bestellung fakturieren'),
 ('network.invoiceorder.title', 'en', 'Create an invoice for what is still to invoice on this order'),
 ('network.invoiceorder.title', 'de', 'Eine Rechnung über das erstellen, was auf dieser Bestellung noch zu fakturieren ist'),
 ('network.invoiceorder.why.closed', 'en', 'The order is closed: it can no longer be invoiced.'),
 ('network.invoiceorder.why.closed', 'de', 'Die Bestellung ist geschlossen: sie kann nicht mehr fakturiert werden.'),
 ('network.invoiceorder.why.onhold', 'en', 'The customer has put this order on hold. Invoice it once they release it.'),
 ('network.invoiceorder.why.onhold', 'de', 'Der Kunde hat diese Bestellung angehalten. Fakturieren Sie sie, sobald er sie freigibt.'),
 ('network.invoiceorder.why.nothingreceived', 'en', 'Nothing received is waiting to be invoiced. This customer matches invoices to the goods they receive.'),
 ('network.invoiceorder.why.nothingreceived', 'de', 'Nichts Eingegangenes wartet auf eine Rechnung. Dieser Kunde gleicht Rechnungen mit den eingegangenen Waren ab.'),
 ('network.invoiceorder.why.allinvoiced', 'en', 'Everything ordered has been invoiced.'),
 ('network.invoiceorder.why.allinvoiced', 'de', 'Alles Bestellte ist fakturiert.'),
 ('network.invoiceorder.filled', 'en', 'Filled from purchase order {order}: a line for each order line still to invoice, at the order''s price. Check the quantities and VAT, and add your invoice number.'),
 ('network.invoiceorder.filled', 'de', 'Aus Bestellung {order} ausgefüllt: eine Position für jede noch zu fakturierende Bestellposition, zum Preis der Bestellung. Prüfen Sie Mengen und MwSt. und ergänzen Sie Ihre Rechnungsnummer.'),
 ('network.invoiceorder.notaccepting', 'en', '{customer} does not take invoices for {company} through the supplier network.'),
 ('network.invoiceorder.notaccepting', 'de', '{customer} nimmt für {company} keine Rechnungen über das Lieferantennetzwerk an.'),
 ('network.order.toinvoice', 'en', 'Still to invoice'),
 ('network.order.toinvoice', 'de', 'Noch zu fakturieren');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.invoiceorder', 'network.invoiceorder.title', 'network.invoiceorder.why.closed', 'network.invoiceorder.why.onhold', 'network.invoiceorder.why.nothingreceived', 'network.invoiceorder.why.allinvoiced', 'network.invoiceorder.filled', 'network.invoiceorder.notaccepting', 'network.order.toinvoice') == 18
