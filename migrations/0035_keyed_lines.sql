-- 0035_keyed_lines.sql
-- Decision 0109 — recording that a person typed a line.
--
-- **The gap this closes.** `key-fields-route.ts` already accepts
-- `body.lines` and passes them to the ordinary writer, so keyed lines
-- have always been storable. What was missing is any record that a
-- *person* typed them: `keyed_fields` is keyed by invoice and field
-- with no line reference, so a typed line amount was indistinguishable
-- from an extracted one.
--
-- That matters for the same reason header provenance does (decision
-- 0071). An auditor asking "who put this figure here" needs an answer,
-- and a rule testing `provenance.keyed` needs the line case to appear
-- there at all.

-- Nullable, and NULL means a header field.
--
-- Chosen over a separate table because the question somebody asks is
-- "what did a person type on this invoice" — one trail, read together.
-- A second table would mean every audit query becoming a union, and the
-- two drifting in exactly the way this project keeps finding.
ALTER TABLE keyed_fields ADD COLUMN line_number INTEGER;

-- The query this supports: everything a person typed on one invoice,
-- header and lines together, most recent first.
CREATE INDEX idx_keyed_fields_invoice_line ON keyed_fields(invoice_id, line_number);

-- Point-in-time: nothing claims to be a line yet.
-- ASSERT: SELECT count(*) FROM keyed_fields WHERE line_number IS NOT NULL == 0

-- Standing invariant: a line number is a real line number.
--
-- `invoice_lines.line_number` starts at 1, and a zero or negative one
-- would point at nothing while looking like a reference. Not a foreign
-- key: the line it names may since have been replaced, and the record
-- of what somebody typed should outlive the row they typed it into.
-- ASSERT ALWAYS: SELECT count(*) FROM keyed_fields WHERE line_number IS NOT NULL AND line_number < 1 == 0

-- Standing invariant, restated from migration 0030: every keyed field
-- still names a real invoice. Restated because this migration touches
-- the table and an invariant that quietly stops applying reads as
-- protection while protecting nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM keyed_fields WHERE invoice_id NOT IN (SELECT id FROM invoice_headers) == 0
