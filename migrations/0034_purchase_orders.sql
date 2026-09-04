-- 0034_purchase_orders.sql
-- Decision 0081 — purchase orders, the first new domain since intake.
--
-- Decision 0079 found `po.matched` and `po.variance_pct` declared in the
-- closed vocabulary and computed by nothing — and, worse, no purchase
-- orders in the system at all. A matching rule compiled, activated,
-- fired on the right invoices and did nothing, because there was
-- nothing to match against.
--
-- Grounded in Peppol BIS Order Only 3.3, checked against
-- docs.peppol.eu rather than recalled — the same discipline the UBL
-- invoice parser's own comments established.
--
-- **Orders do not have BT codes.** The invoice vocabulary is built on
-- EN 16931 Business Terms; BIS Order Only derives from CEN BII Profile
-- 03 and addresses everything by UBL element name. So the columns here
-- are named for what they are, exactly as EXPENSE_FIELDS was (decision
-- 0022): inventing a "PO-n" numbering would falsely imply a standard
-- that does not exist for this document.
CREATE TABLE purchase_orders (
  id                 TEXT PRIMARY KEY,

  -- cbc:ID — the buyer's own order number, and the thing an invoice's
  -- BT-13 (purchase order reference) points at. This is the join that
  -- makes matching possible at all.
  order_number       TEXT NOT NULL,

  -- cbc:IssueDate.
  issue_date         TEXT,

  -- cbc:OrderTypeCode. A closed set from UN/CEFACT 1001, and the spec
  -- is explicit that all of these are synonyms of 220 and processed the
  -- same way unless bilaterally agreed otherwise. Recorded rather than
  -- normalised: a consignment order (227) becoming a plain 220 in
  -- storage would lose a real distinction for the sake of tidiness.
  order_type_code    TEXT CHECK (order_type_code IS NULL OR order_type_code IN
    ('220', '105', '221', '226', '227', '402')),

  -- cbc:DocumentCurrencyCode.
  currency           TEXT,

  -- cac:SellerSupplierParty and cac:BuyerCustomerParty. Stored as the
  -- party identifier, which is what an invoice can be matched against;
  -- the full party structure is deliberately not modelled yet.
  seller_party_id    TEXT,
  buyer_party_id     TEXT,

  -- cac:AnticipatedMonetaryTotal. Every one nullable, because the spec
  -- says the whole class is OPTIONAL — and where present, only
  -- LineExtensionAmount and PayableAmount are mandatory. An order with
  -- no totals at all is valid, and a NOT NULL here would reject
  -- conforming documents.
  line_extension_amount REAL,
  tax_exclusive_amount  REAL,
  tax_inclusive_amount  REAL,
  payable_amount        REAL,

  -- cac:OriginatorDocumentReference/cbc:ID — the buyer's internal
  -- requisition, per the spec's own example.
  originator_reference  TEXT,

  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An order number must be findable, and findable ONCE. Two orders
-- sharing a number would make matching ambiguous in the worst possible
-- way: silently picking one.
CREATE UNIQUE INDEX idx_purchase_orders_number ON purchase_orders(order_number);
CREATE INDEX idx_purchase_orders_seller ON purchase_orders(seller_party_id);

CREATE TABLE purchase_order_lines (
  id                    TEXT PRIMARY KEY,
  purchase_order_id     TEXT NOT NULL REFERENCES purchase_orders(id),

  -- cac:OrderLine/cac:LineItem/cbc:ID.
  line_number           INTEGER NOT NULL,

  -- cbc:Quantity and its mandatory unitCode. The spec is explicit that
  -- every quantity carries a unit, so storing the number alone would
  -- lose half the fact: 120 of something is not a quantity.
  quantity              REAL,
  unit_code             TEXT,

  -- cbc:LineExtensionAmount for the line.
  line_extension_amount REAL,

  -- cac:Item. The spec requires an identifier AND/OR a name on every
  -- line, so neither alone can be NOT NULL — the standing invariant
  -- below expresses the real rule instead.
  item_name             TEXT,
  item_description      TEXT,
  sellers_item_id       TEXT,
  standard_item_id      TEXT,

  -- cac:Price. PriceAmount permits four decimals where amounts permit
  -- two, per the spec's own semantic data types.
  price_amount          REAL,
  base_quantity         REAL,

  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (purchase_order_id, line_number)
);

CREATE INDEX idx_po_lines_order ON purchase_order_lines(purchase_order_id);

-- Point-in-time: both tables exist and are empty.
-- ASSERT: SELECT count(*) FROM purchase_orders == 0
-- ASSERT: SELECT count(*) FROM purchase_order_lines == 0

-- Standing invariant: every line belongs to a real order. The FK
-- enforces it; restated to match every other table here.
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_order_lines WHERE purchase_order_id NOT IN (SELECT id FROM purchase_orders) == 0

-- Standing invariant: an order number is never blank. A blank one
-- cannot be matched against and would sit in storage looking like data.
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_orders WHERE trim(order_number) = '' == 0

-- Standing invariant: the spec's own line rule — "each order line MUST
-- have an item identifier and/or an item name". Expressed here rather
-- than as a NOT NULL on either column, because the requirement is a
-- disjunction and a column constraint cannot say so.
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_order_lines WHERE COALESCE(trim(item_name), '') = '' AND COALESCE(trim(sellers_item_id), '') = '' AND COALESCE(trim(standard_item_id), '') = '' == 0

-- Standing invariant: a quantity always carries its unit. The spec
-- requires a valid unit for every quantity, and a bare number is half a
-- fact.
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_order_lines WHERE quantity IS NOT NULL AND COALESCE(trim(unit_code), '') = '' == 0

-- Standing invariant: the order type stays inside the closed set. The
-- CHECK enforces it; restated so a future change dropping the
-- constraint is caught on the next replay.
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_orders WHERE order_type_code IS NOT NULL AND order_type_code NOT IN ('220', '105', '221', '226', '227', '402') == 0
