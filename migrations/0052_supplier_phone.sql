-- 0052_supplier_phone.sql
--
-- **A number to ring** — decision 0221.
--
-- The operator's own mock-up of the Seller card has one, and neither
-- decision 0207's reading of Oracle nor decision 0219's email thought
-- of it.
--
-- Which is the same omission twice: **a supplier record is for
-- reaching a supplier**, and a person disputing an invoice reaches for
-- a phone before an inbox.
ALTER TABLE suppliers ADD COLUMN phone TEXT;

-- Point-in-time: nothing has one, which is every row loaded before this.
-- ASSERT: SELECT count(*) FROM suppliers WHERE phone IS NOT NULL == 0
