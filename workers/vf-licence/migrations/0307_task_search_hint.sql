-- 0307_task_search_hint.sql
-- Decision 0693 — the Tasks search finds what the card shows: invoice
-- number, supplier name or VAT number, amount as written, PO number and
-- stage. The hint says so.

UPDATE ui_strings SET value = 'Invoice number, supplier, VAT number, amount, PO or stage' WHERE key = 'tasks.searchhint' AND locale = 'en';
UPDATE ui_strings SET value = 'Rechnungsnummer, Lieferant, USt-IdNr., Betrag, Bestellung oder Phase' WHERE key = 'tasks.searchhint' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'tasks.searchhint' AND value LIKE '%nvoice number%' == 1
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'tasks.searchhint' AND value LIKE 'Rechnungsnummer%' == 1
