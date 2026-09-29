-- 0110_route_message_formats.sql
-- Decision 0560 — Routes, phase 2 slice 1: structured formats in.
--
-- Each attachment a route receives now says which e-invoice format it
-- was, and what the EN 16931 checks found. Recorded on the message part
-- because that is where the Route monitor already shows what became of
-- each file, and the Routes screen counts formats from it.
--
-- `format` is one of the closed list in shared/ingestion/invoice-format.ts
-- (NULL for a picture, or a PDF with nothing inside). `syntax` is 'ubl' or
-- 'cii'. `en16931_failed` is a JSON array of {rule, detail?}; NULL where
-- the document was not checked (not structured, or a Factur-X MINIMUM or
-- BASIC WL, which are not EN 16931 invoices).
--
-- No backfill: what an attachment was is known only by reading it, and
-- the parts received before this are counted as they were — by outcome.

ALTER TABLE route_message_parts ADD COLUMN format TEXT;
ALTER TABLE route_message_parts ADD COLUMN syntax TEXT CHECK (syntax IS NULL OR syntax IN ('ubl', 'cii'));
ALTER TABLE route_message_parts ADD COLUMN en16931_failed TEXT;

CREATE INDEX idx_route_message_parts_format ON route_message_parts(format);

-- ASSERT: SELECT count(*) FROM route_message_parts WHERE format IS NOT NULL == 0
-- A syntax is only ever recorded beside a format.
-- ASSERT ALWAYS: SELECT count(*) FROM route_message_parts WHERE syntax IS NOT NULL AND format IS NULL == 0
