-- 0133_supplier_performance_remaining_metrics_strings.sql
--
-- Decision 0421 — the four remaining new cards on the Supplier
-- Performance tab (cycle time, exception rate + type mix, PO
-- variance, payment terms held vs. negotiated), plus the shared
-- "supplier" column header and "{n} days" template both of them use.
-- Active supplier count by status reuses `suppliers.*` strings
-- already in place (migration 0088); spend by supplier already has
-- its own strings (migration carrying `supplierperformance.spend*`).
INSERT INTO ui_strings (key, locale, value) VALUES
 ('supplierperformance.supplier', 'en', 'Supplier'),
 ('supplierperformance.dayscount', 'en', '{n} days'),
 ('supplierperformance.cycletime', 'en', 'Average cycle time'),
 ('supplierperformance.cycletimesub', 'en', 'Receipt to payment-eligible, by supplier'),
 ('supplierperformance.nocycletime', 'en', 'No completed invoices yet'),
 ('supplierperformance.exceptions', 'en', 'Exception rate'),
 ('supplierperformance.exceptionssub', 'en', 'Suppliers with the most validation exceptions, last 90 days'),
 ('supplierperformance.noexceptions', 'en', 'No exceptions recorded'),
 ('supplierperformance.exceptioncount', 'en', 'Exceptions'),
 ('supplierperformance.visitcount', 'en', 'Checked'),
 ('supplierperformance.exceptionrate', 'en', 'Rate'),
 ('supplierperformance.typemix', 'en', 'Most common'),
 ('supplierperformance.povariance', 'en', 'Invoice variance to order value'),
 ('supplierperformance.povariancesub', 'en', 'Average variance from the matched purchase order, by supplier'),
 ('supplierperformance.nopovariance', 'en', 'No PO-matched invoices yet'),
 ('supplierperformance.paymentterms', 'en', 'Payment terms held vs. negotiated'),
 ('supplierperformance.paymenttermssub', 'en', 'What was agreed, what was invoiced, and how often it was on time'),
 ('supplierperformance.nopaymentterms', 'en', 'No comparable payment terms yet'),
 ('supplierperformance.negotiatedterms', 'en', 'Negotiated'),
 ('supplierperformance.heldterms', 'en', 'Invoiced'),
 ('supplierperformance.ontimerate', 'en', 'On time');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('supplierperformance.supplier', 'de', 'Lieferant'),
 ('supplierperformance.dayscount', 'de', '{n} Tage'),
 ('supplierperformance.cycletime', 'de', 'Durchschnittliche Durchlaufzeit'),
 ('supplierperformance.cycletimesub', 'de', 'Eingang bis zahlungsbereit, nach Lieferant'),
 ('supplierperformance.nocycletime', 'de', 'Noch keine abgeschlossenen Rechnungen'),
 ('supplierperformance.exceptions', 'de', 'Ausnahmequote'),
 ('supplierperformance.exceptionssub', 'de', 'Lieferanten mit den meisten Validierungsausnahmen, letzte 90 Tage'),
 ('supplierperformance.noexceptions', 'de', 'Keine Ausnahmen erfasst'),
 ('supplierperformance.exceptioncount', 'de', 'Ausnahmen'),
 ('supplierperformance.visitcount', 'de', 'Geprüft'),
 ('supplierperformance.exceptionrate', 'de', 'Quote'),
 ('supplierperformance.typemix', 'de', 'Am häufigsten'),
 ('supplierperformance.povariance', 'de', 'Abweichung zum Bestellwert'),
 ('supplierperformance.povariancesub', 'de', 'Durchschnittliche Abweichung von der zugeordneten Bestellung, nach Lieferant'),
 ('supplierperformance.nopovariance', 'de', 'Noch keine bestellabgeglichenen Rechnungen'),
 ('supplierperformance.paymentterms', 'de', 'Zahlungsbedingungen: vereinbart vs. gehalten'),
 ('supplierperformance.paymenttermssub', 'de', 'Was vereinbart wurde, was in Rechnung gestellt wurde, und wie oft es pünktlich war'),
 ('supplierperformance.nopaymentterms', 'de', 'Noch keine vergleichbaren Zahlungsbedingungen'),
 ('supplierperformance.negotiatedterms', 'de', 'Vereinbart'),
 ('supplierperformance.heldterms', 'de', 'In Rechnung gestellt'),
 ('supplierperformance.ontimerate', 'de', 'Pünktlich');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('supplierperformance.supplier','supplierperformance.dayscount','supplierperformance.cycletime','supplierperformance.cycletimesub','supplierperformance.nocycletime','supplierperformance.exceptions','supplierperformance.exceptionssub','supplierperformance.noexceptions','supplierperformance.exceptioncount','supplierperformance.visitcount','supplierperformance.exceptionrate','supplierperformance.typemix','supplierperformance.povariance','supplierperformance.povariancesub','supplierperformance.nopovariance','supplierperformance.paymentterms','supplierperformance.paymenttermssub','supplierperformance.nopaymentterms','supplierperformance.negotiatedterms','supplierperformance.heldterms','supplierperformance.ontimerate') == 42
