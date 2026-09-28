-- 0097_restore_keyed_header_columns.sql
-- Decision 0539 — since 0071, every keying save wrote the invoice's
-- structured columns back as NULL (`handleUpsertInvoice` was given only
-- facts and lines). Found when coding suggestions drew on no history:
-- every invoice a person had coded had lost its supplier_vat_id.
--
-- Capture sets these columns from the invoice's own facts (BT-31, BT-1,
-- BT-5, BT-2, BT-112 — intake-capture-route.ts), and keying kept the
-- facts, so each blanked column is refilled from the fact it came from.
-- **Only a NULL column is filled**; nothing that holds a value is
-- touched. mandate_channel is not kept in the facts and cannot be
-- restored here.
UPDATE invoice_headers SET supplier_vat_id = trim(json_extract(facts_json, '$."BT-31"'))
  WHERE supplier_vat_id IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-31"') = 'text'
    AND trim(json_extract(facts_json, '$."BT-31"')) != '';

UPDATE invoice_headers SET invoice_number = trim(json_extract(facts_json, '$."BT-1"'))
  WHERE invoice_number IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-1"') = 'text'
    AND trim(json_extract(facts_json, '$."BT-1"')) != '';

UPDATE invoice_headers SET currency = trim(json_extract(facts_json, '$."BT-5"'))
  WHERE currency IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-5"') = 'text'
    AND trim(json_extract(facts_json, '$."BT-5"')) != '';

UPDATE invoice_headers SET issue_date = trim(json_extract(facts_json, '$."BT-2"'))
  WHERE issue_date IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-2"') = 'text'
    AND trim(json_extract(facts_json, '$."BT-2"')) != '';

UPDATE invoice_headers SET total_with_vat = json_extract(facts_json, '$."BT-112"')
  WHERE total_with_vat IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-112"') IN ('integer', 'real');

UPDATE invoice_headers SET total_with_vat = CAST(trim(json_extract(facts_json, '$."BT-112"')) AS REAL)
  WHERE total_with_vat IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-112"') = 'text'
    AND trim(json_extract(facts_json, '$."BT-112"')) != ''
    AND trim(json_extract(facts_json, '$."BT-112"')) NOT GLOB '*[^0-9.-]*';

-- ASSERT: SELECT count(*) FROM invoice_headers WHERE supplier_vat_id IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-31"') = 'text' AND trim(json_extract(facts_json, '$."BT-31"')) != '' == 0
-- ASSERT: SELECT count(*) FROM invoice_headers WHERE invoice_number IS NULL AND json_valid(facts_json) AND json_type(facts_json, '$."BT-1"') = 'text' AND trim(json_extract(facts_json, '$."BT-1"')) != '' == 0
