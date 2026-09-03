-- 0025_revalidation.sql
-- Decision 0051 — validation before and after rules.
--
-- validation_passed on stage_visits describes the invoice as it
-- ARRIVED. When a rule corrects a field (decision 0049), the stored
-- invoice is no longer the document that was validated, and the
-- recorded verdict describes something that no longer exists.
--
-- Both are kept rather than the second replacing the first, because
-- they answer different questions. "Did this document arrive sound?"
-- is what an auditor asks about a supplier. "Is what we stored
-- sound?" is what the finance team acts on. Replacing the first would
-- lose the fact that a document arrived broken -- which for a
-- regulatory system is the more consequential of the two.
--
-- Nullable, and NULL means "no rule changed anything, so there is no
-- second state". An invoice no rule touched has one validation
-- verdict, not two saying the same thing.
ALTER TABLE stage_visits ADD COLUMN validation_passed_after INTEGER;
ALTER TABLE stage_visits ADD COLUMN validation_failures_after TEXT;

-- Standing invariant: the two after-columns move together, exactly as
-- the original three do. A verdict with no failure list, or a list
-- with no verdict, would mean the row was written by something other
-- than the single operation that produces both.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE (validation_passed_after IS NULL) != (validation_failures_after IS NULL) == 0

-- Standing invariant: an after-verdict is a real boolean.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE validation_passed_after IS NOT NULL AND validation_passed_after NOT IN (0, 1) == 0

-- Standing invariant: a passing after-verdict never carries failures,
-- matching the same rule the original verdict already holds.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE validation_passed_after = 1 AND validation_failures_after != '' == 0

-- Standing invariant: an after-verdict never exists without an
-- original one. Re-validation only happens on a visit that validated
-- in the first place, so the second appearing alone would mean the
-- ordering had broken.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_visits WHERE validation_passed_after IS NOT NULL AND validation_passed IS NULL == 0
