-- 0037_stage_requires_org.sql
-- Decision 0111 — Validation can refuse an invoice it cannot place.
--
-- The operator's requirement:
--
--   Upon entering Validation the Org should be known.
--
-- **That is a hope unless something enforces it.** A stage that can
-- require an org turns it into a rule: an invoice arriving without one
-- stops there and becomes a task, rather than continuing quietly under
-- no org at all and being posted to nobody's books.
--
-- The same shape as decision 0063: a document nothing could read is
-- captured and put in front of a person, never rejected and never
-- guessed at.
--
-- Default false, so every process that existed before this behaves
-- exactly as it did. Requiring an org is a customer's decision about
-- their own process, not a platform default imposed on them.
ALTER TABLE process_stages ADD COLUMN requires_org INTEGER NOT NULL DEFAULT 0;

-- Point-in-time: no stage requires one yet.
-- ASSERT: SELECT count(*) FROM process_stages WHERE requires_org != 0 == 0

-- Standing invariant: the flag stays boolean. A third value would be
-- read as truthy by any language that touched it, silently turning the
-- guard on for stages nobody configured.
-- ASSERT ALWAYS: SELECT count(*) FROM process_stages WHERE requires_org NOT IN (0, 1) == 0
