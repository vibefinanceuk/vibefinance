-- 0199_po_non_po_excluded_string.sql
-- Decision 0544. The PO matching panel's usage bar says how much of
-- the invoice's total its Non-PO lines account for, now left out.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.nonpoexcluded', 'en', 'This invoice''s Non-PO lines ({amount} with VAT) are left out.'),
 ('pomatch.nonpoexcluded', 'de', 'Die Positionen ohne Bestellung dieser Rechnung ({amount} inkl. MwSt.) sind nicht enthalten.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'pomatch.nonpoexcluded' == 2
