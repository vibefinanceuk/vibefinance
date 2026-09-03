-- 0029_propagate_extraction_settings.sql
-- Decision 0066 — configured settings follow the document.
--
-- Decision 0053 put four extraction settings on intake_channels, when a
-- channel was an arrival point and there was one per process. Decision
-- 0061 made channels per-process STRUCTURAL handlers and seeded three
-- new ones, all at the column defaults. Decision 0063 then routed
-- source-addressed capture to those structural channels.
--
-- Which means anything an administrator had configured on the legacy
-- channel is now silently ignored: loadExtractionSettings reads the
-- channel it is given, and source capture gives it ap-live-image, which
-- has never been configured. The API would still report the old value
-- when asked about the old channel, and no document would be read under
-- it.
--
-- The same shape as decisions 0056 and 0057: configuration that exists,
-- reads back correctly, and reaches nothing. Found this time by asking
-- where the settings went rather than by a customer noticing.
--
-- Copies each legacy channel's settings onto its process's structural
-- channels, and only where the structural channel is still at every
-- default -- so a deliberately configured structural channel is never
-- overwritten by an older row.
UPDATE intake_channels
SET
  require_line_description = (
    SELECT legacy.require_line_description FROM intake_channels legacy
    WHERE legacy.process_id = intake_channels.process_id AND legacy.structure IS NULL
    ORDER BY legacy.created_at, legacy.id LIMIT 1
  ),
  max_extracted_lines = (
    SELECT legacy.max_extracted_lines FROM intake_channels legacy
    WHERE legacy.process_id = intake_channels.process_id AND legacy.structure IS NULL
    ORDER BY legacy.created_at, legacy.id LIMIT 1
  ),
  currency_tolerance_minor = (
    SELECT legacy.currency_tolerance_minor FROM intake_channels legacy
    WHERE legacy.process_id = intake_channels.process_id AND legacy.structure IS NULL
    ORDER BY legacy.created_at, legacy.id LIMIT 1
  ),
  conflict_winner = (
    SELECT legacy.conflict_winner FROM intake_channels legacy
    WHERE legacy.process_id = intake_channels.process_id AND legacy.structure IS NULL
    ORDER BY legacy.created_at, legacy.id LIMIT 1
  )
WHERE structure IS NOT NULL
  -- Untouched since seeding. A structural channel someone has already
  -- configured deliberately must not be reverted to a legacy row's
  -- values.
  AND require_line_description = 1
  AND max_extracted_lines = 25
  AND currency_tolerance_minor = 1
  AND conflict_winner = 'first'
  -- Only where there is a legacy row to copy from.
  AND EXISTS (
    SELECT 1 FROM intake_channels legacy
    WHERE legacy.process_id = intake_channels.process_id AND legacy.structure IS NULL
  );

-- Point-in-time: no structural channel is left disagreeing with its
-- process's legacy channel. Stated as a count of disagreements rather
-- than a comparison of totals, so it holds meaningfully on an empty
-- replay database and on a populated one alike.
--
-- Point-in-time rather than ALWAYS: once the legacy channels are retired
-- (decision 0061's own next step), a structural channel legitimately has
-- nothing to agree with, and settings diverge as administrators
-- configure them separately.
-- ASSERT: SELECT count(*) FROM intake_channels c JOIN intake_channels l ON l.process_id = c.process_id AND l.structure IS NULL WHERE c.structure IS NOT NULL AND (c.require_line_description != l.require_line_description OR c.max_extracted_lines != l.max_extracted_lines OR c.currency_tolerance_minor != l.currency_tolerance_minor OR c.conflict_winner != l.conflict_winner) == 0

-- Standing invariant: the settings stay inside their declared bounds
-- after the copy, exactly as migration 0026 requires. A copy is still a
-- write, and the CHECK constraints do not apply to an UPDATE that was
-- written before them in a replay ordering.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE max_extracted_lines <= 0 OR max_extracted_lines > 200 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE currency_tolerance_minor < 0 OR currency_tolerance_minor > 10000 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE conflict_winner NOT IN ('first', 'last') == 0
