-- 0100_cost_centre_gl_codes.sql
-- Decision 0543 — which General Ledger Codes a Cost Centre may be
-- charged with: "can this department incur this type of expense?"
--
-- **Only where links exist** (the operator's choice): a cost centre
-- with no rows here accepts any GL code, so nothing changes until AP
-- Setup links one; once it has rows, only those GL codes are offered
-- and saved on a line coded to it.
--
-- Its own many-to-many table rather than a declared filter (0076): the
-- filter table holds one value per list type per entry, and one GL code
-- is routinely used by many cost centres.
CREATE TABLE cost_centre_gl_codes (
  cost_centre_id TEXT NOT NULL REFERENCES cost_centres(id),
  gl_code_id     TEXT NOT NULL,
  PRIMARY KEY (cost_centre_id, gl_code_id)
);

CREATE INDEX idx_cost_centre_gl_codes_gl ON cost_centre_gl_codes(gl_code_id);

-- ASSERT: SELECT count(*) FROM cost_centre_gl_codes == 0
-- Every linked GL code is one Account Coding holds.
-- ASSERT ALWAYS: SELECT count(*) FROM cost_centre_gl_codes l WHERE NOT EXISTS (SELECT 1 FROM coding_list_entries e WHERE e.list_type_id = 'gl_code' AND e.id = l.gl_code_id) == 0
