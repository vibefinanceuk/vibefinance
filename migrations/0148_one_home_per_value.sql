-- 0148_one_home_per_value.sql — decision 0681.
--
-- One home per value: the Peppol BIS Billing 3.0 / EN 16931 Business
-- Terms in facts_json. Dan, 7 October 2026: "The one home per value is
-- what I'm looking for."
--
-- The header and line columns that held a second copy of a Business
-- Term were written separately from the facts, by some capture paths
-- and not others, so they could disagree: an embedded-XML invoice
-- (Factur-X/ZUGFeRD) arrived with all five header columns NULL, and a
-- save of a scanned invoice blanked its line description. They are now
-- **generated columns**, worked out from facts_json and never written:
--
--   invoice_headers.invoice_number   = BT-1
--   invoice_headers.issue_date       = BT-2
--   invoice_headers.currency         = BT-5
--   invoice_headers.supplier_vat_id  = BT-31
--   invoice_headers.total_with_vat   = BT-112
--   invoice_lines.description        = BT-153, else BT-154
--   invoice_lines.amount             = BT-131
--   invoice_lines.cost_centre        = BT-133
--
-- Every query that reads them is unchanged and now reads the Business
-- Term. Any INSERT or UPDATE that names them is refused by SQLite.
-- Text is trimmed and an empty string reads as NULL; an amount is a
-- number, or NULL when the fact is not one. facts_json that is not
-- valid JSON gives NULL rather than an error.
--
-- mandate_channel and duplicate_confidence stay ordinary columns: they
-- are not Business Terms and have no second home.

DROP INDEX IF EXISTS idx_invoice_headers_supplier;
DROP INDEX IF EXISTS idx_invoice_headers_supplier_number;
DROP INDEX IF EXISTS idx_invoice_lines_cost_centre;

ALTER TABLE invoice_headers DROP COLUMN invoice_number;
ALTER TABLE invoice_headers DROP COLUMN issue_date;
ALTER TABLE invoice_headers DROP COLUMN currency;
ALTER TABLE invoice_headers DROP COLUMN supplier_vat_id;
ALTER TABLE invoice_headers DROP COLUMN total_with_vat;

ALTER TABLE invoice_headers ADD COLUMN invoice_number TEXT GENERATED ALWAYS AS (
  CASE WHEN json_valid(facts_json) AND json_type(facts_json, '$."BT-1"') IN ('text', 'integer', 'real')
    THEN NULLIF(trim(CAST(json_extract(facts_json, '$."BT-1"') AS TEXT)), '') END
) VIRTUAL;
ALTER TABLE invoice_headers ADD COLUMN issue_date TEXT GENERATED ALWAYS AS (
  CASE WHEN json_valid(facts_json) AND json_type(facts_json, '$."BT-2"') = 'text'
    THEN NULLIF(trim(json_extract(facts_json, '$."BT-2"')), '') END
) VIRTUAL;
ALTER TABLE invoice_headers ADD COLUMN currency TEXT GENERATED ALWAYS AS (
  CASE WHEN json_valid(facts_json) AND json_type(facts_json, '$."BT-5"') = 'text'
    THEN NULLIF(trim(json_extract(facts_json, '$."BT-5"')), '') END
) VIRTUAL;
ALTER TABLE invoice_headers ADD COLUMN supplier_vat_id TEXT GENERATED ALWAYS AS (
  CASE WHEN json_valid(facts_json) AND json_type(facts_json, '$."BT-31"') = 'text'
    THEN NULLIF(trim(json_extract(facts_json, '$."BT-31"')), '') END
) VIRTUAL;
ALTER TABLE invoice_headers ADD COLUMN total_with_vat REAL GENERATED ALWAYS AS (
  CASE
    WHEN NOT json_valid(facts_json) THEN NULL
    WHEN json_type(facts_json, '$."BT-112"') IN ('integer', 'real') THEN json_extract(facts_json, '$."BT-112"')
    WHEN json_type(facts_json, '$."BT-112"') = 'text'
      AND trim(json_extract(facts_json, '$."BT-112"')) != ''
      AND trim(json_extract(facts_json, '$."BT-112"')) NOT GLOB '*[^0-9.-]*'
      THEN CAST(trim(json_extract(facts_json, '$."BT-112"')) AS REAL)
  END
) VIRTUAL;

ALTER TABLE invoice_lines DROP COLUMN description;
ALTER TABLE invoice_lines DROP COLUMN amount;
ALTER TABLE invoice_lines DROP COLUMN cost_centre;

ALTER TABLE invoice_lines ADD COLUMN description TEXT GENERATED ALWAYS AS (
  CASE WHEN json_valid(facts_json) THEN COALESCE(
    CASE WHEN json_type(facts_json, '$."BT-153"') = 'text' THEN NULLIF(trim(json_extract(facts_json, '$."BT-153"')), '') END,
    CASE WHEN json_type(facts_json, '$."BT-154"') = 'text' THEN NULLIF(trim(json_extract(facts_json, '$."BT-154"')), '') END
  ) END
) VIRTUAL;
ALTER TABLE invoice_lines ADD COLUMN amount REAL GENERATED ALWAYS AS (
  CASE
    WHEN NOT json_valid(facts_json) THEN NULL
    WHEN json_type(facts_json, '$."BT-131"') IN ('integer', 'real') THEN json_extract(facts_json, '$."BT-131"')
    WHEN json_type(facts_json, '$."BT-131"') = 'text'
      AND trim(json_extract(facts_json, '$."BT-131"')) != ''
      AND trim(json_extract(facts_json, '$."BT-131"')) NOT GLOB '*[^0-9.-]*'
      THEN CAST(trim(json_extract(facts_json, '$."BT-131"')) AS REAL)
  END
) VIRTUAL;
ALTER TABLE invoice_lines ADD COLUMN cost_centre TEXT GENERATED ALWAYS AS (
  CASE WHEN json_valid(facts_json) AND json_type(facts_json, '$."BT-133"') = 'text'
    THEN NULLIF(trim(json_extract(facts_json, '$."BT-133"')), '') END
) VIRTUAL;

CREATE INDEX idx_invoice_headers_supplier ON invoice_headers(supplier_vat_id);
CREATE INDEX idx_invoice_headers_supplier_number ON invoice_headers(supplier_vat_id, invoice_number);
CREATE INDEX idx_invoice_lines_cost_centre ON invoice_lines(cost_centre);

-- Every column now agrees with its Business Term, for every row there is.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_headers WHERE json_valid(facts_json) AND json_type(facts_json, '$."BT-5"') = 'text' AND trim(json_extract(facts_json, '$."BT-5"')) != '' AND currency IS NOT trim(json_extract(facts_json, '$."BT-5"')) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_lines WHERE json_valid(facts_json) AND json_type(facts_json, '$."BT-131"') IN ('integer', 'real') AND amount IS NOT json_extract(facts_json, '$."BT-131"') == 0
