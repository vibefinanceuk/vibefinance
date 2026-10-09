-- 0308_documents_search_hint.sql
-- Decision 0695 — the Documents search reads a term as the Tasks search
-- does (0693): document number, supplier name or VAT number, PO number,
-- sender, and amount as written. The hint says so.

UPDATE ui_strings SET value = 'Document number, supplier, VAT number, PO, sender or amount' WHERE key = 'documents.searchhint' AND locale = 'en';
UPDATE ui_strings SET value = 'Belegnummer, Lieferant, USt-IdNr., Bestellung, Absender oder Betrag' WHERE key = 'documents.searchhint' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'documents.searchhint' AND value LIKE 'Document number%' == 1
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'documents.searchhint' AND value LIKE 'Belegnummer, Lieferant, USt-IdNr.%' == 1
