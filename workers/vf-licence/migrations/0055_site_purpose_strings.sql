-- 0055_site_purpose_strings.sql
-- Decision 0218 — what a site is for, and where it is.
--
-- **`ERP identifier` rather than `Supplier number`.** The label hid the
-- thing that matters: decision 0209's whole argument is that this is
-- what we can name to the ERP, and *supplier number* reads like ours.
UPDATE ui_strings SET value = 'ERP identifier' WHERE key = 'suppliers.erpid' AND locale = 'en';
UPDATE ui_strings SET value = 'ERP-Kennung' WHERE key = 'suppliers.erpid' AND locale = 'de';

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.site', 'en', 'Site'),
 ('suppliers.purpose', 'en', 'Used for'),
 ('suppliers.address', 'en', 'Address'),
 ('suppliers.pay', 'en', 'Payment'),
 ('suppliers.procurement', 'en', 'Procurement'),
 ('suppliers.site', 'de', 'Standort'),
 ('suppliers.purpose', 'de', 'Verwendet für'),
 ('suppliers.address', 'de', 'Anschrift'),
 ('suppliers.pay', 'de', 'Zahlung'),
 ('suppliers.procurement', 'de', 'Beschaffung');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.site','suppliers.purpose','suppliers.address','suppliers.pay','suppliers.procurement') == 10
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.erpid' AND value = 'Supplier number' == 0
