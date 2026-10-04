-- 0131_agent_summary.sql
-- Decision 0626 — Agents, slice 5: the AI summary. A few sentences on top
-- of each copy, written by the AI from that copy's table, in the reader's
-- language, and sent only when every number in it is in the table. On by
-- default (design decision 4), one switch per agent.
--
-- `agent_deliveries.summary` says what became of it for that copy:
-- written, off, mismatch (a number not in the table, so dropped),
-- over_budget (the day's summaries used), ai_unavailable, or no_ai.
-- `agent_ai_days` counts the summaries written each day (UTC), against
-- the licence's `summaryLimit` (default 100).

ALTER TABLE agents ADD COLUMN summary INTEGER NOT NULL DEFAULT 1 CHECK (summary IN (0, 1));
ALTER TABLE agent_deliveries ADD COLUMN summary TEXT CHECK (summary IS NULL OR summary IN ('written', 'off', 'mismatch', 'over_budget', 'ai_unavailable', 'no_ai'));

CREATE TABLE agent_ai_days (
  day       TEXT PRIMARY KEY,
  summaries INTEGER NOT NULL DEFAULT 0 CHECK (summaries >= 0)
);

-- ASSERT ALWAYS: SELECT count(*) FROM agents WHERE summary NOT IN (0, 1) == 0
