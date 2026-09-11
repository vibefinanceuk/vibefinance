-- 0055_a_supplier_awaiting_the_erp.sql
--
-- **A supplier we know about and cannot pay yet** — decision 0231.
--
-- Decision 0209 made `erp_identifier` `NOT NULL` on a real argument:
-- without it, an invoice cannot be named to the ERP and therefore
-- cannot be paid.
--
-- **That argument was about payment and the column was about
-- existence.** The operator:
--
--   A record might be created and details logged before the record is
--   created in the ERP. Receipt of an invoice, and supplier record
--   creation here, could be a precursor to a New Supplier process,
--   engaging with a team to add the information into the ERP.
--
-- Which is the ordinary way a new supplier arrives: an invoice turns
-- up, somebody records who sent it, and the ERP record is created
-- afterwards by a team who need exactly the details that were
-- recorded.
--
-- **Refusing that row forced the work to happen on paper**, outside the
-- system that noticed it was needed.

-- SQLite cannot drop a NOT NULL, so the table is rebuilt.
CREATE TABLE suppliers_new (
  id TEXT PRIMARY KEY,

  -- **Nullable, and still the thing that makes a supplier payable.**
  -- Absent means *awaiting the ERP*, which is a state with work
  -- attached rather than a record that is broken.
  erp_identifier TEXT,

  name TEXT NOT NULL,
  vat_id             TEXT,
  electronic_address TEXT,
  country            TEXT,
  payment_terms      TEXT,
  on_hold     INTEGER NOT NULL DEFAULT 0 CHECK (on_hold IN (0, 1)),
  hold_reason TEXT,
  match_option TEXT CHECK (match_option IN ('two_way', 'three_way', 'none')),
  amount_tolerance_pct   REAL CHECK (amount_tolerance_pct IS NULL OR amount_tolerance_pct >= 0),
  quantity_tolerance_pct REAL CHECK (quantity_tolerance_pct IS NULL OR quantity_tolerance_pct >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  erp_site_identifier TEXT,
  is_pay_site         INTEGER NOT NULL DEFAULT 0 CHECK (is_pay_site IN (0, 1)),
  is_procurement_site INTEGER NOT NULL DEFAULT 0 CHECK (is_procurement_site IN (0, 1)),
  address_line TEXT,
  city         TEXT,
  postal_code  TEXT,
  email        TEXT,
  phone        TEXT,
  loaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO suppliers_new
  SELECT id, erp_identifier, name, vat_id, electronic_address, country, payment_terms,
         on_hold, hold_reason, match_option, amount_tolerance_pct, quantity_tolerance_pct,
         status, erp_site_identifier, is_pay_site, is_procurement_site,
         address_line, city, postal_code, email, phone, loaded_at
  FROM suppliers;

DROP TABLE suppliers;
ALTER TABLE suppliers_new RENAME TO suppliers;

-- Rebuilt with the table. The partial indexes are unchanged in shape:
-- one ERP identifier per site, and one per supplier where there is no
-- site.
CREATE UNIQUE INDEX idx_suppliers_erp
  ON suppliers(erp_identifier, erp_site_identifier)
  WHERE erp_identifier IS NOT NULL AND erp_site_identifier IS NOT NULL;
CREATE UNIQUE INDEX idx_suppliers_erp_no_site
  ON suppliers(erp_identifier)
  WHERE erp_identifier IS NOT NULL AND erp_site_identifier IS NULL;

CREATE INDEX idx_suppliers_vat ON suppliers(vat_id);
CREATE INDEX idx_suppliers_endpoint ON suppliers(electronic_address);
CREATE INDEX idx_suppliers_pay_site ON suppliers(vat_id, is_pay_site);

-- Point-in-time: every supplier loaded so far has an identifier,
-- because every one came from a file the ERP produced.
-- ASSERT: SELECT count(*) FROM suppliers WHERE erp_identifier IS NULL == 0

-- Standing invariant: what decision 0209 was really protecting. An
-- identifier, where present, is a real one — **a blank string is worse
-- than nothing**, because it looks like an answer and cannot be paid
-- against either.
-- ASSERT ALWAYS: SELECT count(*) FROM suppliers WHERE erp_identifier IS NOT NULL AND trim(erp_identifier) = '' == 0

-- Standing invariant: a hold has a reason. Carried over from migration
-- 0049, whose table this replaces.
-- ASSERT ALWAYS: SELECT count(*) FROM suppliers WHERE on_hold = 1 AND (hold_reason IS NULL OR trim(hold_reason) = '') == 0
