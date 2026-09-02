-- 0021_stage_visit_validation.sql
-- Decision 0044 addendum — persisting the validation result.
--
-- Validation results were computed at the start of a stage visit,
-- handed to rule evaluation as derived facts, and then discarded. The
-- rules saw them; nothing else ever did.
--
-- Found the moment it mattered. Establishing whether a real invoice
-- had passed validation required joining stage_visits to
-- stage_visit_steps, reading which rule id had matched, and looking
-- that rule up to infer what it must have tested. That is detective
-- work, and for a regulatory product the question "why was this
-- invoice held?" should be answerable directly from the record.
--
-- Recorded on the stage visit rather than on the invoice, and the
-- distinction is real: validation describes a MOMENT of evaluation,
-- not a permanent property of a document. The same invoice re-visited
-- after a correction should produce a second visit with a different
-- result, and both should survive. Writing it onto invoice_headers
-- would overwrite the first with the second and lose exactly the
-- history an audit needs.
--
-- Nullable, because the overwhelming majority of existing rows
-- predate this and there is no honest value to backfill them with.
-- NULL means "not recorded", which is different from "passed" and
-- must stay different -- inventing a value here would be the same
-- fabrication this whole decision exists to prevent.
ALTER TABLE stage_visits ADD COLUMN validation_passed INTEGER;

-- The named checks that failed, comma-separated, matching the
-- validation.failures fact exactly. Empty string when validation ran
-- and everything passed; NULL when it did not run at all.
ALTER TABLE stage_visits ADD COLUMN validation_failures TEXT;

-- The checks that genuinely ran. A check that could not run is
-- neither a pass nor a failure (decision 0044), and that distinction
-- has to survive into the record or "passed" quietly comes to mean
-- "nothing was checked".
ALTER TABLE stage_visits ADD COLUMN validation_checked TEXT;

-- Standing invariant: the three columns move together. A row with a
-- pass/fail verdict but no record of what was checked would be
-- exactly the ambiguity this migration exists to remove.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE (validation_passed IS NULL) != (validation_checked IS NULL) == 0

-- Standing invariant: the verdict is a real boolean, never some other
-- integer. SQLite would happily store 7 here.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE validation_passed IS NOT NULL AND validation_passed NOT IN (0, 1) == 0

-- Standing invariant: a failure list is never recorded without a
-- verdict. The two are produced together by the same function, and a
-- failure list on its own would mean the record had been written by
-- something other than that function.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE validation_failures IS NOT NULL AND validation_passed IS NULL == 0

-- Standing invariant: a passing verdict never carries failures. This
-- is the one that would catch a real bug -- the verdict and the list
-- are derived from the same result object, so any disagreement means
-- they were written from different sources.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE validation_passed = 1 AND validation_failures != '' == 0
