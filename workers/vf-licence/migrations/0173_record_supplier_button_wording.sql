-- 0173_record_supplier_button_wording.sql
-- Decision 0494 — the "Record this supplier from the invoice" button
-- moved into the search pop-out's own top-right corner, alongside
-- Close, where a label this long would not fit beside a Close icon.
-- Abbreviated, per the request, keeping decision 0233's own choice of
-- word ("Record", not "Create" — the ERP record itself still comes
-- later, from a team; this only writes down who the invoice is from).
UPDATE ui_strings SET value = 'Record New Supplier' WHERE key = 'viewer.supplier.record' AND locale = 'en';
UPDATE ui_strings SET value = 'Neuen Lieferanten erfassen' WHERE key = 'viewer.supplier.record' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.supplier.record' == 2
