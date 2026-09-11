-- 0051_supplier_email.sql
--
-- **Where a person writes to this supplier** — decision 0219.
--
-- Oracle's supplier site has `EmailAddress`, used when the
-- communication method is EMAIL. Decision 0207 put it among the
-- attributes carried and forwarded rather than acted on, which was
-- right about the ERP and wrong about the person: **returning an
-- invoice to a supplier needs an address to return it to**, and
-- decision 0031 built `return_to_supplier` with no way to reach one.
--
-- Deliberately **not** the electronic address. `BT-34` is a Peppol
-- endpoint under a scheme, machine-routed and unreadable; this is where
-- a human sends a question.
ALTER TABLE suppliers ADD COLUMN email TEXT;

-- Point-in-time: nothing has one, which is every row loaded before this.
-- ASSERT: SELECT count(*) FROM suppliers WHERE email IS NOT NULL == 0

-- Standing invariant: an address that cannot be one. Not a full
-- validation — that belongs to whoever typed it — but a value with no
-- `@` at all is a column being used for something else.
-- ASSERT ALWAYS: SELECT count(*) FROM suppliers WHERE email IS NOT NULL AND email NOT LIKE '%@%' == 0
