-- 0050_site_purpose_and_address.sql
--
-- **What a site is for, and where it is** — decision 0218.
--
-- The operator:
--
--   A supplier might have 3 sites in the UK, 2 procurement sites and 1
--   payment site. Effectively where orders are sent, versus where
--   payment is sent.
--
-- These are Oracle's `PurchasingPurposeFlag` and `PayPurposeFlag`, and
-- decision 0207 put them among the attributes that describe **buying**
-- rather than paying — which was wrong about the second one.
--
-- **An invoice arrives at a pay site.** So when several sites share a
-- VAT number and one of them is the pay site, that is not a
-- disambiguation guess: it is what the flag means.

-- **Two flags, not one field with three values.** The operator named
-- the reason:
--
--   Two check boxes needed as a site could be both a payment site and a
--   procurement site.
--
-- An enum of 'pay' | 'procurement' | 'both' says the same thing and
-- makes 'both' look like a third kind of place rather than a site doing
-- two jobs.
ALTER TABLE suppliers ADD COLUMN is_pay_site INTEGER NOT NULL DEFAULT 0
  CHECK (is_pay_site IN (0, 1));
ALTER TABLE suppliers ADD COLUMN is_procurement_site INTEGER NOT NULL DEFAULT 0
  CHECK (is_procurement_site IN (0, 1));

-- **Where it physically is**, which the ERP knows and an invoice shows.
--
-- Decision 0208 held only `country`, because reverse charge behaves
-- differently and a street affects nothing the process does. That is
-- still true of matching — a supplier's invoice often shows their head
-- office whichever site raised it — but it is **not** true of a person
-- resolving which site an invoice belongs to. *"Felixstowe or Dublin"*
-- is the question they are actually answering.
ALTER TABLE suppliers ADD COLUMN address_line TEXT;
ALTER TABLE suppliers ADD COLUMN city TEXT;
ALTER TABLE suppliers ADD COLUMN postal_code TEXT;

CREATE INDEX idx_suppliers_pay_site ON suppliers(vat_id, is_pay_site);

-- Point-in-time: nothing declares a purpose, so every existing row is
-- neither — which is what a load before this migration could say.
-- ASSERT: SELECT count(*) FROM suppliers WHERE is_pay_site = 1 OR is_procurement_site = 1 == 0

-- Standing invariant: a site with no purpose at all is allowed and a
-- site with both is allowed. There is deliberately no rule here —
-- **the ERP decides what a site is for**, and refusing a combination it
-- exported would be this system correcting a master it mirrors
-- (decision 0208).
--
-- What is worth stating is that the flags stay boolean: anything other
-- than 0 or 1 is a column being used as a comment.
-- ASSERT ALWAYS: SELECT count(*) FROM suppliers WHERE is_pay_site NOT IN (0, 1) OR is_procurement_site NOT IN (0, 1) == 0
