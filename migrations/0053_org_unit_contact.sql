-- 0053_org_unit_contact.sql
--
-- **Where we are, so a person can check the invoice is ours** —
-- decision 0224.
--
-- Decision 0219 put our record of the *supplier* beside the document so
-- somebody could compare it with the image. The buyer is the same
-- question from the other side, and the operator asked for the same
-- shape: *"Name, VAT no, E-address, E-mail, Phone and Address."*
--
-- `org_units` had the identifiers an invoice is **matched on** (decision
-- 0036: `vat_id`, `buyer_endpoint`, `buyer_reference`) and nothing a
-- person reads. An invoice printing *"Acme UK Limited, 1 Handover
-- Street"* cannot be checked against a VAT number alone.
ALTER TABLE org_units ADD COLUMN address_line TEXT;
ALTER TABLE org_units ADD COLUMN city TEXT;
ALTER TABLE org_units ADD COLUMN postal_code TEXT;
ALTER TABLE org_units ADD COLUMN country TEXT;

-- **Where a supplier writes to us**, which is not where we write to
-- them. A supplier querying an invoice needs an AP address, and the one
-- on decision 0219's supplier record points the other way.
ALTER TABLE org_units ADD COLUMN email TEXT;
ALTER TABLE org_units ADD COLUMN phone TEXT;

-- Point-in-time: nothing has any of these, which is every unit created
-- before now.
-- ASSERT: SELECT count(*) FROM org_units WHERE address_line IS NOT NULL OR email IS NOT NULL == 0

-- Standing invariant: an address that cannot be one. The same shape as
-- migration 0051's, and for the same reason — not a validation, which
-- belongs to whoever typed it, but a value with no `@` at all is a
-- column being used for something else.
-- ASSERT ALWAYS: SELECT count(*) FROM org_units WHERE email IS NOT NULL AND email NOT LIKE '%@%' == 0
