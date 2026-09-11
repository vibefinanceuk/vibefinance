-- 0049_supplier_mirror.sql
--
-- **A mirror, not a master** — decisions 0207, 0208, 0209.
--
-- Decision 0207 found there was no supplier record at all: a seller
-- existed only as facts on an invoice, copied onto
-- `invoice_headers.supplier_vat_id` so duplicate detection could group
-- by it.
--
-- The operator settled what this is:
--
--   We are the mirror. A customer would need to supply us with a
--   supplier master file, and we would hold a small subset of the
--   information that impacts workflow.
--
-- Which removes most of Oracle's eighty supplier-site attributes. There
-- is no create, no merge, no duplicate resolution and no vendor
-- approval here — that is the ERP's, and reimplementing it would be
-- reimplementing the ERP.

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,

  -- **The reason this record exists** — decision 0209.
  --
  -- The operator:
  --
  --   Key to the mirror is having an ERP Identifier. If we do not have
  --   that, it indicates a new supplier record. Otherwise when we pass
  --   the information to the ERP, it will not know who it belongs to.
  --
  -- So this is `NOT NULL` by definition rather than by policy. A row
  -- without one is not a supplier we could pay against; it is a note
  -- about a company, and this table would then be a master pretending
  -- to be a mirror.
  erp_identifier TEXT NOT NULL,

  name TEXT NOT NULL,

  -- **What an arriving invoice is matched on.** `BT-31` and `BT-34` as
  -- the standard names them — decision 0204's mechanism with the fields
  -- reversed, since that record matched the *buyer* on BT-48 and BT-49.
  vat_id           TEXT,
  electronic_address TEXT,

  -- Reverse charge and intra-community supply behave differently, so
  -- the country is not decoration.
  country TEXT,

  -- **Terms are what was agreed**; `BT-9` is what the supplier claims.
  -- They can disagree, and decision 0208 left open whether one wins.
  payment_terms TEXT,

  -- An invoice from a held supplier routes differently, and a hold
  -- nobody can see is a hold nobody applies.
  on_hold     INTEGER NOT NULL DEFAULT 0 CHECK (on_hold IN (0, 1)),
  hold_reason TEXT,

  -- Two-way against a purchase order or three-way against a receipt.
  -- **This decides which stages an invoice visits.**
  match_option TEXT CHECK (match_option IN ('two_way', 'three_way', 'none')),

  -- When a match fails, and by how much before it does.
  amount_tolerance_pct   REAL CHECK (amount_tolerance_pct IS NULL OR amount_tolerance_pct >= 0),
  quantity_tolerance_pct REAL CHECK (quantity_tolerance_pct IS NULL OR quantity_tolerance_pct >= 0),

  -- **A supplier absent from a later load is inactive, never deleted**
  -- (decision 0208). An invoice already pointing at one must still be
  -- able to say who it was.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),

  -- Oracle's site is `(supplier, procurement BU)` — the relationship
  -- rather than the address (decision 0207). A customer's spreadsheet
  -- may have one row per supplier or one per site, and this holds the
  -- first exactly while extending to the second **without a migration
  -- that moves data** (decision 0208).
  erp_site_identifier TEXT,

  loaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One supplier per ERP identifier and site. Two rows for the same one
-- would make matching depend on row order, which is not a rule anybody
-- could state.
CREATE UNIQUE INDEX idx_suppliers_erp
  ON suppliers(erp_identifier, erp_site_identifier)
  WHERE erp_site_identifier IS NOT NULL;
CREATE UNIQUE INDEX idx_suppliers_erp_no_site
  ON suppliers(erp_identifier)
  WHERE erp_site_identifier IS NULL;

CREATE INDEX idx_suppliers_vat ON suppliers(vat_id);
CREATE INDEX idx_suppliers_endpoint ON suppliers(electronic_address);

-- **When the mirror was last told the truth** — decision 0208.
--
-- A stale mirror lies confidently: a supplier added to the ERP on
-- Monday and loaded here on Friday means four days of invoices routed
-- for review, each correct according to this system and wrong in fact.
--
-- So an unmatched supplier is reported **with this date beside it**.
-- *"The supplier list was loaded eleven days ago"* is the fact that
-- tells somebody what to do; without it, *"unknown supplier"* reads as
-- advice to create one — which, as a mirror, is exactly what we must
-- not suggest.
CREATE TABLE supplier_loads (
  id          TEXT PRIMARY KEY,
  loaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  loaded_by   TEXT NOT NULL,
  row_count   INTEGER NOT NULL CHECK (row_count >= 0),
  -- How many rows the load refused, and why, so a customer whose
  -- spreadsheet is half wrong learns that rather than discovering it
  -- one invoice at a time.
  refused_count INTEGER NOT NULL DEFAULT 0 CHECK (refused_count >= 0)
);

-- Which supplier an invoice belongs to, where one was matched.
ALTER TABLE invoice_headers ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);

-- Named apart from 0007's `idx_invoice_headers_supplier`, which indexes
-- the VAT **string** on the invoice. Two different questions: *which
-- invoices claim this VAT number* and *which belong to this supplier
-- record*.
CREATE INDEX idx_invoice_headers_supplier_ref ON invoice_headers(supplier_id);

-- Point-in-time: nothing is loaded and nothing is matched, which is the
-- honest starting state.
-- ASSERT: SELECT count(*) FROM suppliers == 0
-- ASSERT: SELECT count(*) FROM invoice_headers WHERE supplier_id IS NOT NULL == 0

-- Standing invariant: every supplier has an ERP identifier. Stated here
-- as well as in the column, because it is the whole argument for this
-- table: a supplier we cannot name to the ERP is one we cannot pay
-- against.
-- ASSERT ALWAYS: SELECT count(*) FROM suppliers WHERE erp_identifier IS NULL OR trim(erp_identifier) = '' == 0

-- Standing invariant: a hold has a reason. A held supplier nobody can
-- explain is a payment stopped for no stated cause, which is worse than
-- one stopped for a bad one.
-- ASSERT ALWAYS: SELECT count(*) FROM suppliers WHERE on_hold = 1 AND (hold_reason IS NULL OR trim(hold_reason) = '') == 0

-- Standing invariant: an invoice's supplier exists. The foreign key
-- says so; this states it where a reader of the migrations will see it.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_headers h LEFT JOIN suppliers s ON s.id = h.supplier_id WHERE h.supplier_id IS NOT NULL AND s.id IS NULL == 0
