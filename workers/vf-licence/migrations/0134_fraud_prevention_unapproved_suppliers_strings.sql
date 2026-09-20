-- 0134_fraud_prevention_unapproved_suppliers_strings.sql
--
-- Decision 0422 — the Fraud Prevention tab's second real metric,
-- "Unapproved-supplier invoices — an invoice referencing a supplier
-- not on file, or on hold" (the design's own second bullet under
-- Screen 3 — Fraud & Risk Detection's key metrics), gated on
-- `AP.FraudReview`. Reuses `fraudprevention.invoicenumber` /
-- `.supplier` / `.amount` / `.issuedate` from decision 0420's own
-- migration 0132 — same tab, same columns, only the new ones added
-- here.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.unapprovedsuppliers', 'en', 'Unapproved-supplier invoices'),
 ('fraudprevention.unapprovedsupplierssub', 'en', 'A supplier not on file, or one currently on hold'),
 ('fraudprevention.nounapprovedsuppliers', 'en', 'No unapproved-supplier invoices right now'),
 ('fraudprevention.reason', 'en', 'Reason'),
 ('fraudprevention.reasonnotonfile', 'en', 'Not on file'),
 ('fraudprevention.reasononhold', 'en', 'On hold');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.unapprovedsuppliers', 'de', 'Rechnungen von nicht genehmigten Lieferanten'),
 ('fraudprevention.unapprovedsupplierssub', 'de', 'Ein nicht erfasster Lieferant oder einer, der derzeit gesperrt ist'),
 ('fraudprevention.nounapprovedsuppliers', 'de', 'Derzeit keine Rechnungen von nicht genehmigten Lieferanten'),
 ('fraudprevention.reason', 'de', 'Grund'),
 ('fraudprevention.reasonnotonfile', 'de', 'Nicht erfasst'),
 ('fraudprevention.reasononhold', 'de', 'Gesperrt');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('fraudprevention.unapprovedsuppliers','fraudprevention.unapprovedsupplierssub','fraudprevention.nounapprovedsuppliers','fraudprevention.reason','fraudprevention.reasonnotonfile','fraudprevention.reasononhold') == 12
