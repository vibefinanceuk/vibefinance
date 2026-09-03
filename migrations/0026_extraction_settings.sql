-- 0026_extraction_settings.sql
-- Decision 0053 — extraction assumptions become configuration.
--
-- Every extraction decision made so far came from a sample of one: a
-- German freight invoice with an unusual two-page structure. The
-- findings were real and the assumptions are reasonable, but they
-- were written as platform code, which asserts "this is always true".
--
-- They are not always true. They are sensible defaults. An
-- administrator whose invoices carry unlabelled rows, or run to
-- eighty lines, or accumulate more rounding than a penny, should be
-- able to see the assumption and change it -- rather than discover it
-- when their data is silently dropped.
--
-- Per channel, following hybrid_pdf_fallback (decision 0042), and for
-- the same reason: one customer may have a scanner feeding clean
-- invoices and a mailbox receiving whatever arrives, and those
-- genuinely warrant different handling.
--
-- Every default below is exactly the behaviour already shipped, so
-- applying this migration changes nothing until somebody edits a
-- value. That is deliberate: a migration that silently altered how
-- documents are read would be a far worse thing to deploy.

-- Decision 0052. A row with no description is not treated as a line
-- item. True of real invoices; false for a customer whose rows are
-- identified by code alone.
ALTER TABLE intake_channels
  ADD COLUMN require_line_description INTEGER NOT NULL DEFAULT 1
  CHECK (require_line_description IN (0, 1));

-- Decision 0043, lowered twice against real failures. Bounds the
-- response so it completes; too low silently truncates a genuinely
-- long itemised invoice, which is reported rather than hidden.
ALTER TABLE intake_channels
  ADD COLUMN max_extracted_lines INTEGER NOT NULL DEFAULT 25
  CHECK (max_extracted_lines > 0 AND max_extracted_lines <= 200);

-- Decision 0044. Currency comparison tolerance, in the invoice's own
-- units. A penny covers per-line rounding on invoices of realistic
-- length; a very long invoice can legitimately accumulate more.
-- Stored in whole minor units (pence/cents) rather than as a float,
-- so the setting itself cannot suffer the floating-point problem it
-- exists to solve.
ALTER TABLE intake_channels
  ADD COLUMN currency_tolerance_minor INTEGER NOT NULL DEFAULT 1
  CHECK (currency_tolerance_minor >= 0 AND currency_tolerance_minor <= 10000);

-- Decision 0046. Which page wins when two disagree. 'first' matches
-- the shipped behaviour and suits documents whose header repeats;
-- 'last' suits documents where a later page supersedes.
ALTER TABLE intake_channels
  ADD COLUMN conflict_winner TEXT NOT NULL DEFAULT 'first'
  CHECK (conflict_winner IN ('first', 'last'));

-- Standing invariant: the line cap is always a workable number. Zero
-- would ask for no lines while appearing to ask for some, and an
-- unbounded value would reintroduce the timeout decision 0047 exists
-- to prevent.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE max_extracted_lines <= 0 OR max_extracted_lines > 200 == 0

-- Standing invariant: tolerance is never negative. A negative
-- tolerance would make every comparison fail, including on correct
-- invoices, in a way that would look like a data problem rather than
-- a configuration one.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE currency_tolerance_minor < 0 == 0

-- Standing invariant: the closed sets stay closed. Enforced by CHECK
-- at write time too; restated so the runner re-checks it on every
-- replay, independent of whether a future change ever drops the
-- constraint.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE conflict_winner NOT IN ('first', 'last') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE require_line_description NOT IN (0, 1) == 0
