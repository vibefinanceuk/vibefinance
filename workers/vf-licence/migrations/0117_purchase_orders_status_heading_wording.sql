-- 0117_purchase_orders_status_heading_wording.sql
-- Decision 0377 addendum — the operator's own follow-up: the status
-- card's title read simply "Status", easy to misread as a property of
-- the whole screen rather than specifically the purchase order in
-- front of it. "Purchase Order Status" says which.
--
-- An UPDATE, not an edit to migration 0116 itself — that migration is
-- already applied, and an applied migration is not edited without
-- saying so (§6). This is the saying so.
UPDATE ui_strings SET value = 'Purchase Order Status' WHERE key = 'purchaseorders.statusheading' AND locale = 'en';
UPDATE ui_strings SET value = 'Bestellstatus' WHERE key = 'purchaseorders.statusheading' AND locale = 'de';

-- Point-in-time: both locales carry the new wording.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'purchaseorders.statusheading' AND value IN ('Purchase Order Status', 'Bestellstatus') == 2
