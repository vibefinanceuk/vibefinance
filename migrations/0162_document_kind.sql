-- 0162_document_kind.sql — decision 0730.
--
-- Invoice or credit note, by the document's own type code (BT-3): the
-- UNTDID 1001 codes EN 16931 treats as credit notes are a credit note,
-- anything else (or none) an invoice. Generated from facts_json, as the
-- other columns read from it are (0148), so every way a document arrives
-- (UBL, CII, a supplier mapping, the network) says the same thing.

ALTER TABLE invoice_headers ADD COLUMN document_kind TEXT GENERATED ALWAYS AS (
  CASE WHEN json_valid(facts_json) AND json_type(facts_json, '$."BT-3"') IN ('text', 'integer')
        AND trim(CAST(json_extract(facts_json, '$."BT-3"') AS TEXT)) IN ('81', '83', '261', '262', '296', '308', '381', '396', '420', '458', '532')
    THEN 'credit_note' ELSE 'invoice' END
) VIRTUAL;

-- ASSERT: SELECT count(*) FROM invoice_headers WHERE document_kind NOT IN ('invoice', 'credit_note') == 0
