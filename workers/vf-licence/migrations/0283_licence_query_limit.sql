-- 0283_licence_query_limit.sql
-- Decision 0638 — Agents ask the data, slice 5: agents' own questions a
-- day, per licence (Dan, 5 October 2026: a switch, on by default, with a
-- daily allowance per tier). NULL: the default allowance. 0: questions
-- are left out of the tier. Passed to vf-app as `queryLimit`.

ALTER TABLE licences ADD COLUMN query_limit INTEGER CHECK (query_limit IS NULL OR query_limit >= 0);

-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE query_limit < 0 == 0
