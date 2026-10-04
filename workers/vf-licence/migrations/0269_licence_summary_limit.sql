-- 0269_licence_summary_limit.sql
-- Decision 0626 — Agents, slice 5: the AI summary. Each environment's
-- licence says how many agent summaries the AI may write a day (Dan, 4
-- October 2026: a daily count on the licence). The signed token carries it
-- to vf-app as `summaryLimit`. NULL means the licence names none, and
-- vf-app uses its own default (100). Past it, reports still go out,
-- without a summary, and say why.

ALTER TABLE licences ADD COLUMN summary_limit INTEGER CHECK (summary_limit IS NULL OR summary_limit >= 0);

-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE summary_limit < 0 == 0
