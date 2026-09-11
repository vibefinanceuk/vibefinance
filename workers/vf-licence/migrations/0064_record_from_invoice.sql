-- 0064_record_from_invoice.sql
-- Decision 0233 — capturing a supplier from the invoice in front of you.
--
-- **"Record this supplier", not "create".** A person keying an invoice
-- is writing down who sent it, and the ERP record comes afterwards from
-- a team. *Create* would suggest the job is finished.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier.record', 'en', 'Record this supplier from the invoice'),
 ('suppliers.adopted', 'en', '{n} suppliers recorded here have been matched to the ERP and now have an identifier.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier.record', 'de', 'Diesen Lieferanten aus der Rechnung erfassen'),
 ('suppliers.adopted', 'de', '{n} hier erfasste Lieferanten wurden dem ERP zugeordnet und haben jetzt eine Kennung.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.supplier.record','suppliers.adopted') == 4
