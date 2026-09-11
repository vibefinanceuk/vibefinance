-- 0063_awaiting_erp_strings.sql
-- Decision 0231 — a supplier the ERP does not have yet.
--
-- **"Awaiting", not "missing".** A supplier recorded before the ERP
-- record exists is not an incomplete row: it is the precursor to a
-- new-supplier process, and somebody has work to do rather than a
-- mistake to fix.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.new', 'en', 'Record a new supplier'),
 ('suppliers.create', 'en', 'Record supplier'),
 ('suppliers.newhelp', 'en', 'For a supplier your ERP does not have yet. Leave the ERP identifier blank — invoices from them will be recognised, and flagged as not yet payable until the ERP record exists.'),
 ('suppliers.awaitingerp', 'en', 'This supplier has no ERP identifier yet, so invoices from them cannot be paid until the ERP record is created.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.new', 'de', 'Neuen Lieferanten erfassen'),
 ('suppliers.create', 'de', 'Lieferant erfassen'),
 ('suppliers.newhelp', 'de', 'Für einen Lieferanten, den Ihr ERP noch nicht hat. Lassen Sie die ERP-Kennung leer — Rechnungen von ihnen werden erkannt und als noch nicht zahlbar gekennzeichnet, bis der ERP-Datensatz existiert.'),
 ('suppliers.awaitingerp', 'de', 'Dieser Lieferant hat noch keine ERP-Kennung, daher können Rechnungen von ihm erst nach Anlage des ERP-Datensatzes bezahlt werden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.new','suppliers.create','suppliers.newhelp','suppliers.awaitingerp') == 8
